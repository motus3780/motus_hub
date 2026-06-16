// 위클리 작업: 주간 뉴스 집계 → AI 요약 → 발송 (멱등성 보장)
//
// 일간(dailyJob.ts)의 아키텍처를 그대로 따라가되, 주간 범위와 위클리 테이블/템플릿을 사용합니다.
//
// 주요 차이점:
//   - 수집은 일간이 매일 돌고 있다고 가정 (별도 수집 단계 없음)
//   - 직전 주 월~일(weekStart~weekEnd) 범위의 누적 뉴스로 요약
//   - 발송 잡 ID: 'weekly_2026-05-04' (week_start_date 기반)
//   - 이메일 템플릿: renderWeeklyEmail
//   - 제목: "[모투스 위클리] VOL.XXX · YYYY년 M월 N주차"

import { getNewsByWeek, pickWeeklyTop3 } from './news'
import {
  generateWeeklySummary,
  saveWeeklySummary,
  getWeeklySummary,
  extractMarketOneliner,
  getPersonalizedWeeklySummary,
  type PersonalizedWeeklyRow,
} from './ai'
import {
  sendEmailWithRetry, logEmailSend, sleep, loadResendConfig,
  type SendAttemptResult,
} from './email'
import { getActiveSubscribers, listSubscribersByCompanyProfile } from './subscriber'
import { getCompanyProfile, type CompanyProfile } from './companyProfiles'
import { getActiveContents } from './content'
import { getSettings, setSetting, SETTING_KEYS } from './settings'
import { renderWeeklyEmail, makeWeeklySubject } from '../templates/email'
import {
  nowKST,
  getLastWeekRange,
  formatWeekRangeKo,
  formatIssueLabelKo,
  formatNextIssueKo,
} from './utils'
import {
  acquireSendJob,
  finalizeSendJob,
  releaseSendJob,
  setSendJobPlan,
  incrementSendJobCounter,
  recordEmailSend,
  getAlreadySentSubscriberIds,
  makeWeeklyJobId,
  getSendJob,
  type SendTrigger,
} from './sendJob'
import { sanityCheckSummary } from './politicsFilter'
import { getSectionImageMap, listWeeklyTopImages } from './weeklyImages'

// === Rate Limiting (일간과 동일) ===
const SEND_DELAY_MS = 600
const SEND_DELAY_MS_SMALL = 350  // 구독자 20명 미만 소규모 단축 (초당 2건 한도 내)
const SMALL_SUBSCRIBER_THRESHOLD = 20
const BATCH_THRESHOLD = 100
const BATCH_SIZE = 10
const BATCH_INTERVAL_MS = 1000

export interface WeeklySendProgress {
  running: boolean
  jobId?: string
  volNo?: number
  weekStart?: string
  total: number
  current: number
  sent: number
  failed: number
  skipped: number
  currentEmail?: string
  startedAt: string
  finishedAt?: string
  estimatedSeconds?: number
  errors: string[]
}

export interface WeeklyJobResult {
  weekStart: string
  weekEnd: string
  issueDate: string
  volNo?: number
  jobId?: string
  articleCount: number
  summaryGenerated: boolean
  marketOneliner: string | null
  top3Count: number
  emailsSent: number
  emailsFailed: number
  emailsSkipped: number
  errors: string[]
  alreadyCompleted?: boolean
  // 발송 직전 sanity check 결과 (정치 키워드/정치인 등 매칭)
  sanityWarnings?: string[]
}

async function updateWeeklyProgress(db: D1Database, progress: WeeklySendProgress): Promise<void> {
  await setSetting(db, 'weekly_send_progress', JSON.stringify(progress))
}

function estimateSeconds(total: number): number {
  if (total < BATCH_THRESHOLD) {
    return Math.ceil((total * SEND_DELAY_MS) / 1000)
  }
  const batches = Math.ceil(total / BATCH_SIZE)
  return Math.ceil((batches * BATCH_INTERVAL_MS) / 1000) + Math.ceil((total * 200) / 1000)
}

/**
 * 위클리 작업 실행
 *
 * 단계:
 *   1) 주간 범위 결정 (직전 주 월~일, 발행일=이번 주 월요일)
 *   2) 주간 뉴스 조회 → TOP 3 선정
 *   3) Claude로 위클리 요약 생성 (또는 기존 요약 재사용)
 *   4) weekly_summaries + weekly_top_news 저장
 *   5) (skipSend=false) 발송 잡 락 획득 → 배치 발송
 *
 * opts:
 *   - referenceDate: 발송 기준일 (보통 현재 KST 월요일). 미지정 시 nowKST() 사용
 *   - weekStart/weekEnd/issueDate: 명시적으로 주간 지정 (수동 백필용)
 *   - skipGenerate: AI 요약 생략 (기존 weekly_summaries 사용)
 *   - skipSend: 저장만 하고 발송 안 함 (미리보기/테스트)
 *   - trigger: 'cron' | 'manual' | 'cron-test'
 */
export async function runWeeklyJob(
  db: D1Database,
  opts: {
    referenceDate?: Date
    weekStart?: string
    weekEnd?: string
    issueDate?: string
    skipGenerate?: boolean
    skipSend?: boolean
    trigger?: SendTrigger
    /**
     * 발송 시 제외할 company_profile 목록 (예: ['gs','hyundai'])
     * — 회사 맞춤본 별도 발송 시, 일반본은 회사 미지정 구독자만 받게 하기 위함
     */
    excludeCompanyProfiles?: string[]
    /** 운영자 명시적 재발송: 'completed' 상태도 우회하고 모든 구독자에게 다시 발송 */
    force?: boolean
  } = {},
  env?: { RESEND_API_KEY?: string }
): Promise<WeeklyJobResult> {
  const trigger: SendTrigger = opts.trigger || 'manual'

  // 1) 주간 범위 결정
  let weekStart: string
  let weekEnd: string
  let issueDate: string
  if (opts.weekStart && opts.weekEnd && opts.issueDate) {
    weekStart = opts.weekStart
    weekEnd = opts.weekEnd
    issueDate = opts.issueDate
  } else {
    const range = getLastWeekRange(opts.referenceDate || nowKST())
    weekStart = range.weekStart
    weekEnd = range.weekEnd
    issueDate = range.issueDate
  }

  const result: WeeklyJobResult = {
    weekStart,
    weekEnd,
    issueDate,
    articleCount: 0,
    summaryGenerated: false,
    marketOneliner: null,
    top3Count: 0,
    emailsSent: 0,
    emailsFailed: 0,
    emailsSkipped: 0,
    errors: [],
  }

  // 2) 주간 뉴스 + TOP 3
  const weekNews = await getNewsByWeek(db, weekStart, weekEnd)
  result.articleCount = weekNews.length
  const top3 = pickWeeklyTop3(weekNews, weekStart, weekEnd)
  result.top3Count = top3.length

  // 3) AI 요약 생성 (또는 기존 사용)
  let summaryContent = ''
  let volNo: number | undefined
  let marketOneliner: string | null = null

  try {
    const existing = await getWeeklySummary(db, weekStart)
    if (existing && opts.skipGenerate) {
      summaryContent = existing.summary.content
      marketOneliner = existing.summary.market_oneliner
      volNo = existing.summary.vol_no
      result.summaryGenerated = true
    } else {
      summaryContent = await generateWeeklySummary(db, weekStart, weekEnd, top3, weekNews)
      marketOneliner = extractMarketOneliner(summaryContent)
      const saved = await saveWeeklySummary({
        db,
        weekStart, weekEnd, issueDate,
        content: summaryContent,
        marketOneliner,
        top3,
        articleCount: weekNews.length,
        status: 'ready',
      })
      volNo = saved.volNo
      result.summaryGenerated = true
    }
  } catch (e: any) {
    result.errors.push(`AI 요약 실패: ${e.message}`)
    summaryContent = `## ✍️ 이번 주 시장 한 줄 요약\n이번 주 요약을 생성하지 못했습니다.\n`
  }

  result.volNo = volNo
  result.marketOneliner = marketOneliner

  // 4) 발송 (skipSend면 여기서 종료)
  if (opts.skipSend) return result

  // ── 발송 직전 sanity check: 요약 본문에 정치 키워드·정치인·광고 용어가 잔존하는지 점검
  // 매칭 시 result.errors + result.sanityWarnings에 기록하고 콘솔 경고 (발송 자체는 진행 — 즉시 차단은 운영자가 결정)
  const sanity = sanityCheckSummary(summaryContent)
  if (!sanity.passed) {
    result.sanityWarnings = sanity.warnings
    for (const w of sanity.warnings) {
      result.errors.push(`[sanityCheck] ${w}`)
      console.warn(`[WeeklyJob] sanityCheck 경고: ${w}`)
    }
    console.warn(`[WeeklyJob] ${weekStart} 요약에 정치/광고 용어 잔존 — 운영자 검토 권장 (발송은 진행)`)
  } else {
    console.log(`[WeeklyJob] sanityCheck 통과 (정치/광고 용어 없음)`)
  }

  // === 멱등성 락 획득 (위클리 전용 job_id) ===
  // force=true 이면 'completed' 상태 우회 + email_send_log 리셋되어 전원 재발송
  const weeklyJobId = makeWeeklyJobId(weekStart)
  const job = await acquireSendJob(db, trigger, issueDate, weeklyJobId, !!opts.force)
  if (opts.force) {
    console.log(`[WeeklyJob] ⚡ force=true: 운영자 명시적 재발송 모드 (멱등성 우회)`)
  }
  if (!job) {
    const existing = await getSendJob(db, weeklyJobId)
    result.alreadyCompleted = existing?.status === 'completed'
    result.jobId = existing?.job_id
    if (existing?.status === 'completed') {
      const msg = `[멱등성] ${weeklyJobId} 는 이미 'completed' 상태 — 발송 생략 (${existing.success_count}건 성공, ${existing.failed_count}건 실패)`
      console.log(msg)
      result.errors.push(msg)
      result.emailsSent = existing.success_count
      result.emailsFailed = existing.failed_count
    } else {
      const msg = `[락] ${weeklyJobId} 가 다른 인스턴스에서 실행 중 — 발송 생략`
      console.log(msg)
      result.errors.push(msg)
    }
    return result
  }

  result.jobId = job.job_id

  try {
    const settings = await getSettings(db, [
      SETTING_KEYS.SITE_URL,
      SETTING_KEYS.COMPANY_LOGO_URL,
      SETTING_KEYS.SENDER_NAME,
    ])
    const siteUrl = settings[SETTING_KEYS.SITE_URL] || ''
    const logoUrl = settings[SETTING_KEYS.COMPANY_LOGO_URL] || null
    const senderName = settings[SETTING_KEYS.SENDER_NAME] || '모투스 위클리'

    const rawAllSubscribers = await getActiveSubscribers(db)
    const companyContents = await getActiveContents(db, { emailOnly: true, limit: 3 })

    // 회사 맞춤본 발송 대상이 있으면, 해당 company_profile 구독자는 일반본에서 제외
    const excludeSet = new Set((opts.excludeCompanyProfiles || []).filter(Boolean))
    const allSubscribers = excludeSet.size === 0
      ? rawAllSubscribers
      : rawAllSubscribers.filter((s: any) => !s.company_profile || !excludeSet.has(s.company_profile))

    if (excludeSet.size > 0) {
      const excludedCount = rawAllSubscribers.length - allSubscribers.length
      console.log(`[WeeklyJob] 일반본 라우팅: 회사 맞춤본 발송 대상 ${excludedCount}명 제외 (excludeCompanyProfiles=${[...excludeSet].join(',')})`)
    }

    // 이미 이 job에서 발송 성공한 구독자 skip (재진입 안전)
    const already = await getAlreadySentSubscriberIds(db, job.job_id)
    const subscribers = allSubscribers.filter(s => {
      if (s.id != null && already.ids.has(s.id)) return false
      if (already.emails.has((s.email || '').toLowerCase())) return false
      return true
    })

    const resendCfg = await loadResendConfig(db, env)

    const estSec = estimateSeconds(subscribers.length)
    await setSendJobPlan(db, job.job_id, allSubscribers.length, estSec)

    console.log(`[WeeklyJob] ${job.job_id} 시작: VOL.${volNo}, 대상 ${allSubscribers.length}명, skip ${allSubscribers.length - subscribers.length}, 신규 ${subscribers.length}, 예상 ${estSec}초 (${trigger})`)

    // 위클리 메타 (모든 발송에 공통)
    const weekRangeKo = formatWeekRangeKo(weekStart, weekEnd)
    const issueLabelKo = formatIssueLabelKo(weekStart)
    const nextIssueKo = formatNextIssueKo(issueDate)
    const subject = makeWeeklySubject(volNo || 0, issueLabelKo, marketOneliner)

    // TOP 3는 weekly_top_news 형태로 다시 빌드 (이메일 템플릿 호환)
    const top3ForEmail = top3.map(p => ({
      id: 0,
      week_start_date: weekStart,
      rank: p.rank,
      news_id: p.news.id ?? null,
      title: p.news.title,
      summary: null,
      link: p.news.link,
      source: p.news.source,
      category: p.news.category,
      created_at: '',
    }))

    // 운영자 업로드 이미지 로드 (카테고리 대표 이미지 + 호별 TOP 이미지)
    const sectionImages = await getSectionImageMap(db)
    const topImageRows = await listWeeklyTopImages(db, weekStart)
    const topImages = topImageRows.map(t => ({
      slot: t.slot,
      image_url: t.image_url,
      caption: t.caption,
      link_url: t.link_url,
    }))
    console.log(`[WeeklyJob] ${job.job_id} 이미지 로드: 섹션 ${Object.keys(sectionImages).length}장, TOP ${topImages.length}장`)

    // 진행상황 초기화
    const progress: WeeklySendProgress = {
      running: true,
      jobId: job.job_id,
      volNo,
      weekStart,
      total: allSubscribers.length,
      current: 0,
      sent: already.ids.size + already.emails.size,
      failed: 0,
      skipped: allSubscribers.length - subscribers.length,
      startedAt: new Date().toISOString(),
      estimatedSeconds: estSec,
      errors: [],
    }
    await updateWeeklyProgress(db, progress)

    // 발송 모드 분기
    if (subscribers.length >= BATCH_THRESHOLD) {
      for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
        const batch = subscribers.slice(i, i + BATCH_SIZE)
        await Promise.all(batch.map(async (sub) => {
          await processOneWeeklySubscriber(db, env, job.job_id, {
            sub, summaryContent, top3: top3ForEmail, companyContents,
            siteUrl, logoUrl, senderName, subject,
            volNo: volNo || 0,
            weekStart, weekEnd, issueDate,
            weekRangeKo, issueLabelKo, nextIssueKo,
            marketOneliner, articleCount: weekNews.length,
            sectionImages, topImages,
            resendCfg, progress, result,
          })
        }))
        await updateWeeklyProgress(db, progress)
        if (i + BATCH_SIZE < subscribers.length) {
          await sleep(BATCH_INTERVAL_MS)
        }
      }
    } else {
      const delay = subscribers.length < SMALL_SUBSCRIBER_THRESHOLD ? SEND_DELAY_MS_SMALL : SEND_DELAY_MS
      for (let i = 0; i < subscribers.length; i++) {
        const sub = subscribers[i]
        await processOneWeeklySubscriber(db, env, job.job_id, {
          sub, summaryContent, top3: top3ForEmail, companyContents,
          siteUrl, logoUrl, senderName, subject,
          volNo: volNo || 0,
          weekStart, weekEnd, issueDate,
          weekRangeKo, issueLabelKo, nextIssueKo,
          marketOneliner, articleCount: weekNews.length,
          sectionImages, topImages,
          resendCfg, progress, result,
        })
        await updateWeeklyProgress(db, progress)
        if (i < subscribers.length - 1) {
          await sleep(delay)
        }
      }
    }

    result.emailsSkipped = allSubscribers.length - subscribers.length
    progress.running = false
    progress.finishedAt = new Date().toISOString()
    progress.currentEmail = undefined
    await updateWeeklyProgress(db, progress)

    await finalizeSendJob(db, job.job_id, 'completed')

    // 발송 완료 시 weekly_summaries.status = 'sent'
    if (volNo) {
      await db.prepare(`
        UPDATE weekly_summaries
        SET status = 'sent', updated_at = CURRENT_TIMESTAMP
        WHERE week_start_date = ?
      `).bind(weekStart).run().catch(() => {})
    }

    console.log(`[WeeklyJob] ${job.job_id} 완료: 성공 ${result.emailsSent}, 실패 ${result.emailsFailed}, skip ${result.emailsSkipped}`)
  } catch (e: any) {
    const errMsg = e?.message || String(e)
    console.error(`[WeeklyJob] ${job.job_id} 예외 발생, 락 해제:`, errMsg)
    await releaseSendJob(db, job.job_id, errMsg)
    result.errors.push(`발송 작업 예외: ${errMsg}`)
  }

  return result
}

/** 구독자 1명 발송 처리 (위클리) */
async function processOneWeeklySubscriber(
  db: D1Database,
  env: any,
  jobId: string,
  ctx: any
): Promise<void> {
  const sub = ctx.sub
  ctx.progress.current++
  ctx.progress.currentEmail = sub.email

  try {
    const html = renderWeeklyEmail({
      volNo: ctx.volNo,
      weekStart: ctx.weekStart,
      weekEnd: ctx.weekEnd,
      issueDate: ctx.issueDate,
      weekRangeKo: ctx.weekRangeKo,
      issueLabelKo: ctx.issueLabelKo,
      nextIssueKo: ctx.nextIssueKo,
      marketOneliner: ctx.marketOneliner,
      summaryMarkdown: ctx.summaryContent,
      top3: ctx.top3,
      totalArticles: ctx.articleCount,
      companyContents: ctx.companyContents,
      siteUrl: ctx.siteUrl,
      unsubscribeToken: sub.unsubscribe_token,
      logoUrl: ctx.logoUrl,
      senderName: ctx.senderName,
      // 운영자 업로드 이미지 (카테고리 대표 + 호별 TOP)
      sectionImages: ctx.sectionImages,
      topImages: ctx.topImages,
    } as any)

    const result: SendAttemptResult = await sendEmailWithRetry(db, {
      to: sub.email,
      toName: sub.name || undefined,
      subject: ctx.subject,
      html,
    }, env, ctx.resendCfg)

    if (result.ok) {
      await recordEmailSend(db, {
        jobId,
        subscriberId: sub.id,
        recipient: sub.email,
        status: 'success',
        resendId: result.resendId,
        attempts: result.attempts,
        errorCode: 'OK',
      })
      await logEmailSend(db, sub.id, sub.email, ctx.issueDate, 'success')
      await incrementSendJobCounter(db, jobId, 'success_count')
      ctx.result.emailsSent++
      ctx.progress.sent++
    } else {
      const errMsg = `[${result.errorCode}] ${result.errorMessage || '알 수 없는 오류'} (시도 ${result.attempts}회)`
      await recordEmailSend(db, {
        jobId,
        subscriberId: sub.id,
        recipient: sub.email,
        status: 'failed',
        attempts: result.attempts,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      })
      await logEmailSend(db, sub.id, sub.email, ctx.issueDate, 'failed', errMsg)
      await incrementSendJobCounter(db, jobId, 'failed_count')
      ctx.result.emailsFailed++
      ctx.result.errors.push(`${sub.email}: ${errMsg}`)
      ctx.progress.failed++
      ctx.progress.errors.push(`${sub.email}: ${errMsg}`)
    }
  } catch (e: any) {
    const errMsg = e?.message || String(e)
    await recordEmailSend(db, {
      jobId,
      subscriberId: sub.id,
      recipient: sub.email,
      status: 'failed',
      attempts: 1,
      errorCode: 'NETWORK',
      errorMessage: errMsg,
    }).catch(() => {})
    await logEmailSend(db, sub.id, sub.email, ctx.issueDate, 'failed', errMsg).catch(() => {})
    await incrementSendJobCounter(db, jobId, 'failed_count').catch(() => {})
    ctx.result.emailsFailed++
    ctx.result.errors.push(`${sub.email}: ${errMsg}`)
    ctx.progress.failed++
    ctx.progress.errors.push(`${sub.email}: ${errMsg}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 회사 맞춤 위클리 발송 (운영자 검수 통과본 사용)
//
// 흐름:
//   1) weekly_personalized_summaries 에서 status='approved' 행을 찾음
//      - 운영자 1차 검수까지 통과한 본문만 발송 대상
//      - 'ready' (자동검증 통과·검수 대기) 도 forceUnreviewed 옵션으로 허용
//   2) subscribers 중 company_profile 이 일치하는 활성 구독자를 추림
//   3) job_id 패턴: weekly_<weekStart>_<companyProfile>
//      - 일반 위클리 잡과 별개 락 → 회사 단위 멱등성 보장
//   4) 본문은 personalized.content / subject는 personalized.market_oneliner 기반
//   5) 발송 완료 시 weekly_personalized_summaries.status='sent' 갱신
// ─────────────────────────────────────────────────────────────────────────

export interface PersonalizedWeeklyJobResult {
  weekStart: string
  companyProfile: string
  jobId?: string
  volNo?: number
  total: number
  sent: number
  failed: number
  skipped: number
  errors: string[]
  alreadyCompleted?: boolean
  skippedReason?: string
}

export async function runPersonalizedWeeklyJob(
  db: D1Database,
  opts: {
    weekStart: string
    companyProfile: string
    /** true 면 status='ready' 도 발송 (운영자 검수 우회) */
    forceUnreviewed?: boolean
    /** 운영자 명시적 재발송: 'completed' 상태도 우회하고 모든 구독자에게 다시 발송 */
    force?: boolean
    trigger?: SendTrigger
  },
  env?: { RESEND_API_KEY?: string },
): Promise<PersonalizedWeeklyJobResult> {
  const trigger: SendTrigger = opts.trigger || 'manual'
  const result: PersonalizedWeeklyJobResult = {
    weekStart: opts.weekStart,
    companyProfile: opts.companyProfile,
    total: 0, sent: 0, failed: 0, skipped: 0, errors: [],
  }

  // 1) 회사 프로필 검증
  const profile: CompanyProfile | null = getCompanyProfile(opts.companyProfile)
  if (!profile) {
    result.errors.push(`유효하지 않은 company_profile: ${opts.companyProfile}`)
    result.skippedReason = 'invalid_profile'
    return result
  }

  // 2) 회사 맞춤본 조회 (운영자 검수 정책 적용)
  const row = await getPersonalizedWeeklySummary(db, opts.weekStart, profile.key)
  if (!row) {
    result.errors.push(`회사 맞춤 위클리 본문이 없습니다. 먼저 /admin/api/personalized-weekly/generate 호출 필요.`)
    result.skippedReason = 'no_personalized_body'
    return result
  }

  const allowedStatuses: string[] = ['approved', 'sent']
  if (opts.forceUnreviewed) allowedStatuses.push('ready')
  if (!allowedStatuses.includes(row.status)) {
    result.errors.push(
      `회사 맞춤 위클리 status='${row.status}' — 발송 불가 (필요: ${allowedStatuses.join('/')}). ` +
      `자동검증 통과 후 운영자 검수(POST /admin/api/personalized-weekly/review) 필요.`
    )
    result.skippedReason = `status_${row.status}`
    return result
  }

  result.volNo = row.vol_no

  // 3) 대상 구독자 (회사 프로필 일치한 활성 구독자)
  const subs = await listSubscribersByCompanyProfile(db, profile.key)
  if (subs.length === 0) {
    result.skippedReason = 'no_subscribers'
    console.log(`[PersonalizedWeeklyJob] ${profile.key} 활성 구독자 0명 — 발송 생략`)
    return result
  }
  result.total = subs.length

  // 4) 잡 락 (회사별 독립)
  // force=true 이면 'completed' 상태 우회 + email_send_log 리셋되어 전원 재발송
  const personalizedJobId = `${makeWeeklyJobId(opts.weekStart)}_${profile.key}`
  const job = await acquireSendJob(db, trigger, row.issue_date, personalizedJobId, !!opts.force)
  if (opts.force) {
    console.log(`[PersonalizedWeeklyJob] ⚡ force=true: 운영자 명시적 재발송 모드 (멱등성 우회) - ${profile.key}`)
  }
  if (!job) {
    const existing = await getSendJob(db, personalizedJobId)
    result.alreadyCompleted = existing?.status === 'completed'
    result.jobId = existing?.job_id
    if (existing?.status === 'completed') {
      result.skippedReason = 'already_completed'
      result.sent = existing.success_count
      result.failed = existing.failed_count
      console.log(`[PersonalizedWeeklyJob] ${personalizedJobId} 이미 완료 — 멱등성 보호`)
    } else {
      result.skippedReason = 'locked_by_other_worker'
      console.log(`[PersonalizedWeeklyJob] ${personalizedJobId} 다른 워커 점유 중`)
    }
    return result
  }
  result.jobId = job.job_id

  try {
    const settings = await getSettings(db, [
      SETTING_KEYS.SITE_URL,
      SETTING_KEYS.COMPANY_LOGO_URL,
      SETTING_KEYS.SENDER_NAME,
    ])
    const siteUrl = settings[SETTING_KEYS.SITE_URL] || ''
    const logoUrl = settings[SETTING_KEYS.COMPANY_LOGO_URL] || null
    const senderName = settings[SETTING_KEYS.SENDER_NAME] || '모투스 위클리'
    const companyContents = await getActiveContents(db, { emailOnly: true, limit: 3 })

    const already = await getAlreadySentSubscriberIds(db, job.job_id)
    const targets = subs.filter((s: any) => {
      if (s.id != null && already.ids.has(s.id)) return false
      if (already.emails.has((s.email || '').toLowerCase())) return false
      return true
    })

    const resendCfg = await loadResendConfig(db, env)
    const estSec = estimateSeconds(targets.length)
    await setSendJobPlan(db, job.job_id, subs.length, estSec)

    const weekRangeKo = formatWeekRangeKo(opts.weekStart, row.week_end_date)
    const issueLabelKo = formatIssueLabelKo(opts.weekStart)
    const nextIssueKo = formatNextIssueKo(row.issue_date)
    // 회사 맞춤본 제목에는 회사명 prefix
    const baseSubject = makeWeeklySubject(row.vol_no || 0, issueLabelKo, row.market_oneliner)
    const subject = `[${profile.displayName} 맞춤] ${baseSubject}`

    // 회사 맞춤본은 TOP3를 별도 보관하지 않음 → 빈 배열로 (본문 안에 GS 위클리 섹션 포함됨)
    const top3ForEmail: any[] = []

    // 운영자 업로드 이미지 로드 (카테고리 대표 이미지 + 호별 TOP 이미지)
    const sectionImages = await getSectionImageMap(db)
    const topImageRows = await listWeeklyTopImages(db, opts.weekStart)
    const topImages = topImageRows.map(t => ({
      slot: t.slot,
      image_url: t.image_url,
      caption: t.caption,
      link_url: t.link_url,
    }))
    console.log(`[PersonalizedWeeklyJob] ${job.job_id} 이미지 로드: 섹션 ${Object.keys(sectionImages).length}장, TOP ${topImages.length}장`)

    const progress: WeeklySendProgress = {
      running: true,
      jobId: job.job_id,
      volNo: row.vol_no,
      weekStart: opts.weekStart,
      total: subs.length,
      current: 0,
      sent: already.ids.size + already.emails.size,
      failed: 0,
      skipped: subs.length - targets.length,
      startedAt: new Date().toISOString(),
      estimatedSeconds: estSec,
      errors: [],
    }
    await setSetting(db, `weekly_send_progress_${profile.key}`, JSON.stringify(progress))

    console.log(`[PersonalizedWeeklyJob] ${job.job_id} 시작: VOL.${row.vol_no}, ${profile.displayName}, 대상 ${subs.length}명, 신규 ${targets.length}, 예상 ${estSec}초`)

    const ctxResultShim = {
      emailsSent: 0,
      emailsFailed: 0,
      emailsSkipped: 0,
      errors: [] as string[],
    }

    const dispatchOne = async (sub: any) => {
      await processOneWeeklySubscriber(db, env, job.job_id, {
        sub,
        summaryContent: row.content,
        top3: top3ForEmail,
        companyContents,
        siteUrl, logoUrl, senderName, subject,
        volNo: row.vol_no || 0,
        weekStart: opts.weekStart,
        weekEnd: row.week_end_date,
        issueDate: row.issue_date,
        weekRangeKo, issueLabelKo, nextIssueKo,
        marketOneliner: row.market_oneliner,
        articleCount: row.article_count,
        sectionImages, topImages,
        resendCfg, progress, result: ctxResultShim,
      })
    }

    if (targets.length >= BATCH_THRESHOLD) {
      for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        const batch = targets.slice(i, i + BATCH_SIZE)
        await Promise.all(batch.map(dispatchOne))
        await setSetting(db, `weekly_send_progress_${profile.key}`, JSON.stringify(progress))
        if (i + BATCH_SIZE < targets.length) await sleep(BATCH_INTERVAL_MS)
      }
    } else {
      const delay = targets.length < SMALL_SUBSCRIBER_THRESHOLD ? SEND_DELAY_MS_SMALL : SEND_DELAY_MS
      for (let i = 0; i < targets.length; i++) {
        await dispatchOne(targets[i])
        await setSetting(db, `weekly_send_progress_${profile.key}`, JSON.stringify(progress))
        if (i < targets.length - 1) await sleep(delay)
      }
    }

    result.sent = ctxResultShim.emailsSent
    result.failed = ctxResultShim.emailsFailed
    result.skipped = subs.length - targets.length
    result.errors.push(...ctxResultShim.errors)

    progress.running = false
    progress.finishedAt = new Date().toISOString()
    progress.currentEmail = undefined
    await setSetting(db, `weekly_send_progress_${profile.key}`, JSON.stringify(progress))

    await finalizeSendJob(db, job.job_id, 'completed')

    // 발송 완료 시 weekly_personalized_summaries.status = 'sent'
    await db.prepare(`
      UPDATE weekly_personalized_summaries
      SET status = 'sent', updated_at = CURRENT_TIMESTAMP
      WHERE week_start_date = ? AND company_profile = ?
    `).bind(opts.weekStart, profile.key).run().catch(() => {})

    console.log(`[PersonalizedWeeklyJob] ${job.job_id} 완료: 성공 ${result.sent}, 실패 ${result.failed}`)
  } catch (e: any) {
    const errMsg = e?.message || String(e)
    console.error(`[PersonalizedWeeklyJob] ${job.job_id} 예외, 락 해제:`, errMsg)
    await releaseSendJob(db, job.job_id, errMsg)
    result.errors.push(`예외: ${errMsg}`)
  }

  return result
}

/**
 * 한 주차에 등록된 모든 회사 맞춤본을 일괄 발송 (운영자 검수 통과본만)
 * - 회사 단위로 순차 실행 (각 회사 잡은 독립 락)
 */
export async function runAllPersonalizedWeeklyJobs(
  db: D1Database,
  opts: { weekStart: string; trigger?: SendTrigger; forceUnreviewed?: boolean; force?: boolean },
  env?: { RESEND_API_KEY?: string },
): Promise<PersonalizedWeeklyJobResult[]> {
  // 같은 주차의 모든 회사 맞춤본 조회
  const allRows = await db.prepare(
    'SELECT company_profile FROM weekly_personalized_summaries WHERE week_start_date = ? ORDER BY company_profile ASC'
  ).bind(opts.weekStart).all<{ company_profile: string }>()

  const results: PersonalizedWeeklyJobResult[] = []
  for (const row of allRows.results) {
    const r = await runPersonalizedWeeklyJob(
      db,
      {
        weekStart: opts.weekStart,
        companyProfile: row.company_profile,
        trigger: opts.trigger,
        forceUnreviewed: opts.forceUnreviewed,
        force: opts.force,
      },
      env,
    )
    results.push(r)
  }
  return results
}
