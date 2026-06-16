// 일일 작업: 뉴스 수집 → AI 요약 → 이메일 발송 (멱등성 보장)

import { collectNewsForToday, getNewsByDate, pickBalancedTopNews } from './news'
import { generateSummary, saveSummary, getSummaryByDate } from './ai'
import { sendEmailWithRetry, logEmailSend, sleep, loadResendConfig, type SendAttemptResult } from './email'
import { getActiveSubscribers } from './subscriber'
import { getActiveContents } from './content'
import { getSettings, setSetting, SETTING_KEYS } from './settings'
import { renderDailyEmail } from '../templates/email'
import { todayKST } from './utils'
import {
  acquireSendJob,
  finalizeSendJob,
  releaseSendJob,
  setSendJobPlan,
  incrementSendJobCounter,
  recordEmailSend,
  getAlreadySentSubscriberIds,
  makeJobId,
  getSendJob,
  type SendTrigger,
} from './sendJob'
import { getSectionImageMap } from './weeklyImages'

// === Rate Limiting 설정 ===
// Resend Free Plan: 초당 2건 → 600ms 간격 (20명 미만은 350ms로 단축)
const SEND_DELAY_MS = 600
const SEND_DELAY_MS_SMALL = 350  // 구독자 20명 미만 소규모 단축 (초당 2건 한도 내)
const SMALL_SUBSCRIBER_THRESHOLD = 20
// 100명 이상이면 배치 모드: 10명씩 묶어 병렬, 배치 간 1초 대기
const BATCH_THRESHOLD = 100
const BATCH_SIZE = 10
const BATCH_INTERVAL_MS = 1000

// 진행 상황을 settings 테이블에 저장 (key: send_progress)
async function updateProgress(db: D1Database, progress: SendProgress): Promise<void> {
  await setSetting(db, 'send_progress', JSON.stringify(progress))
}

export interface SendProgress {
  running: boolean
  jobId?: string
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

export interface DailyJobResult {
  date: string
  jobId?: string
  newsCollected: number
  newsCounts: Record<string, number>
  summaryGenerated: boolean
  emailsSent: number
  emailsFailed: number
  emailsSkipped: number
  errors: string[]
  alreadyCompleted?: boolean
}

/**
 * 발송 예상 시간 계산
 *  - 100명 미만: total * 600ms
 *  - 100명 이상: ceil(total/10) 배치 * (10*200ms 평균 + 1000ms) ≈ ceil(total/10) * 1200ms
 */
function estimateSeconds(total: number): number {
  if (total < BATCH_THRESHOLD) {
    return Math.ceil((total * SEND_DELAY_MS) / 1000)
  }
  const batches = Math.ceil(total / BATCH_SIZE)
  return Math.ceil((batches * BATCH_INTERVAL_MS) / 1000) + Math.ceil((total * 200) / 1000)
}

export async function runDailyJob(
  db: D1Database,
  opts: {
    skipCollect?: boolean
    skipSend?: boolean
    trigger?: SendTrigger
    /** 운영자 명시적 재발송: 'completed' 상태도 우회하고 모든 구독자에게 다시 발송 */
    force?: boolean
  } = {},
  env?: { RESEND_API_KEY?: string }
): Promise<DailyJobResult> {
  const date = todayKST()
  const trigger: SendTrigger = opts.trigger || 'manual'
  const result: DailyJobResult = {
    date,
    newsCollected: 0,
    newsCounts: {},
    summaryGenerated: false,
    emailsSent: 0,
    emailsFailed: 0,
    emailsSkipped: 0,
    errors: []
  }

  // 1) 뉴스 수집
  if (!opts.skipCollect) {
    try {
      const r = await collectNewsForToday(db)
      result.newsCollected = r.collected
      result.newsCounts = r.categories
    } catch (e: any) {
      result.errors.push(`뉴스 수집 실패: ${e.message}`)
    }
  }

  // 2) AI 요약 생성
  const news = await getNewsByDate(db, date)
  let summaryContent = ''
  try {
    const existing = await getSummaryByDate(db, date)
    if (existing && opts.skipCollect) {
      summaryContent = existing.content
      result.summaryGenerated = true
    } else {
      summaryContent = await generateSummary(db, news, date)
      await saveSummary(db, date, summaryContent, news.length)
      result.summaryGenerated = true
    }
  } catch (e: any) {
    result.errors.push(`AI 요약 실패: ${e.message}`)
    summaryContent = '오늘의 요약을 생성하지 못했습니다.'
  }

  // 3) 이메일 발송
  if (opts.skipSend) return result

  // === 멱등성 락 획득 ===
  // force=true 이면 'completed' 상태 우회 + email_send_log 리셋되어 전원 재발송
  const job = await acquireSendJob(db, trigger, date, undefined, !!opts.force)
  if (opts.force) {
    console.log(`[DailyJob] ⚡ force=true: 운영자 명시적 재발송 모드 (멱등성 우회)`)
  }
  if (!job) {
    // 이미 completed 또는 다른 워커에서 running 중
    const existing = await getSendJob(db, makeJobId(date))
    result.alreadyCompleted = existing?.status === 'completed'
    result.jobId = existing?.job_id
    if (existing?.status === 'completed') {
      const msg = `[멱등성] ${existing.job_id} 는 이미 'completed' 상태 — 발송 생략 (${existing.success_count}건 성공, ${existing.failed_count}건 실패)`
      console.log(msg)
      result.errors.push(msg)
      result.emailsSent = existing.success_count
      result.emailsFailed = existing.failed_count
    } else {
      const msg = `[락] ${existing?.job_id || makeJobId(date)} 가 다른 인스턴스에서 실행 중 — 발송 생략`
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
      SETTING_KEYS.SENDER_NAME
    ])
    const siteUrl = settings[SETTING_KEYS.SITE_URL] || ''
    const logoUrl = settings[SETTING_KEYS.COMPANY_LOGO_URL] || null
    const senderName = settings[SETTING_KEYS.SENDER_NAME] || '모투스 위클리'

    const allSubscribers = await getActiveSubscribers(db)
    const companyContents = await getActiveContents(db, { emailOnly: true, limit: 3 })
    // 카테고리 균형 배분된 TOP 15건 (부동산 5 / 도시정비 5 / AI 3 / 기타 2)
    const topNews = pickBalancedTopNews(news, 15)

    // 운영자 업로드 카테고리 대표 이미지 로드 (위클리 이미지 관리 페이지에서 등록)
    // 데일리 메일에서는 카테고리 그룹 헤더 이미지로 사용됨
    const sectionImages = await getSectionImageMap(db)
    console.log(`[SendJob] ${job.job_id} 카테고리 대표 이미지 로드: ${Object.keys(sectionImages).length}장`)

    // 이미 이 job에서 발송 성공한 구독자는 skip (재진입 안전)
    const already = await getAlreadySentSubscriberIds(db, job.job_id)
    const subscribers = allSubscribers.filter(s => {
      if (s.id != null && already.ids.has(s.id)) return false
      if (already.emails.has((s.email || '').toLowerCase())) return false
      return true
    })

    // Resend 설정을 한 번만 로드 (반복 DB 조회 방지)
    const resendCfg = await loadResendConfig(db, env)

    // 발송 계획 기록
    const estSec = estimateSeconds(subscribers.length)
    await setSendJobPlan(db, job.job_id, allSubscribers.length, estSec)

    console.log(`[SendJob] ${job.job_id} 시작: 대상 ${allSubscribers.length}명, skip(이미 발송) ${allSubscribers.length - subscribers.length}명, 신규 ${subscribers.length}명, 예상 ${estSec}초 (${trigger})`)

    // 진행 상황 초기화
    const progress: SendProgress = {
      running: true,
      jobId: job.job_id,
      total: allSubscribers.length,
      current: 0,
      sent: already.ids.size + already.emails.size,  // 이미 보낸 건수 표기
      failed: 0,
      skipped: allSubscribers.length - subscribers.length,
      startedAt: new Date().toISOString(),
      estimatedSeconds: estSec,
      errors: []
    }
    await updateProgress(db, progress)

    // === 발송 모드 분기 ===
    if (subscribers.length >= BATCH_THRESHOLD) {
      // 배치 모드: 10명씩 병렬 + 배치 간 1초 대기
      for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
        const batch = subscribers.slice(i, i + BATCH_SIZE)
        await Promise.all(batch.map(async (sub) => {
          await processOneSubscriber(db, env, job.job_id, {
            sub, news, topNews, companyContents,
            siteUrl, logoUrl, senderName, summaryContent,
            date, newsCounts: result.newsCounts,
            sectionImages,
            resendCfg, progress, result
          })
        }))
        await updateProgress(db, progress)
        if (i + BATCH_SIZE < subscribers.length) {
          await sleep(BATCH_INTERVAL_MS)
        }
      }
    } else {
      // 순차 모드: 구독자 20명 미만이면 350ms, 이상이면 600ms
      const delay = subscribers.length < SMALL_SUBSCRIBER_THRESHOLD ? SEND_DELAY_MS_SMALL : SEND_DELAY_MS
      for (let i = 0; i < subscribers.length; i++) {
        const sub = subscribers[i]
        await processOneSubscriber(db, env, job.job_id, {
          sub, news, topNews, companyContents,
          siteUrl, logoUrl, senderName, summaryContent,
          date, newsCounts: result.newsCounts,
          sectionImages,
          resendCfg, progress, result
        })
        await updateProgress(db, progress)
        if (i < subscribers.length - 1) {
          await sleep(delay)
        }
      }
    }

    result.emailsSkipped = allSubscribers.length - subscribers.length
    progress.running = false
    progress.finishedAt = new Date().toISOString()
    progress.currentEmail = undefined
    await updateProgress(db, progress)

    // 작업 종료
    await finalizeSendJob(db, job.job_id, 'completed')
    console.log(`[SendJob] ${job.job_id} 완료: 성공 ${result.emailsSent}, 실패 ${result.emailsFailed}, skip ${result.emailsSkipped}`)
  } catch (e: any) {
    const errMsg = e?.message || String(e)
    console.error(`[SendJob] ${job.job_id} 예외 발생, 락 해제:`, errMsg)
    await releaseSendJob(db, job.job_id, errMsg)
    result.errors.push(`발송 작업 예외: ${errMsg}`)
  }

  return result
}

/** 구독자 1명 발송 처리 (성공/실패 모두 멱등성 로그에 기록) */
async function processOneSubscriber(
  db: D1Database,
  env: any,
  jobId: string,
  ctx: any
): Promise<void> {
  const sub = ctx.sub
  ctx.progress.current++
  ctx.progress.currentEmail = sub.email

  try {
    const html = renderDailyEmail({
      date: ctx.date,
      summaryMarkdown: ctx.summaryContent,
      totalArticles: ctx.news.length,
      newsCounts: ctx.newsCounts,
      topNews: ctx.topNews,
      companyContents: ctx.companyContents,
      siteUrl: ctx.siteUrl,
      unsubscribeToken: sub.unsubscribe_token,
      logoUrl: ctx.logoUrl,
      senderName: ctx.senderName,
      sectionImages: ctx.sectionImages,
    })

    const result: SendAttemptResult = await sendEmailWithRetry(db, {
      to: sub.email,
      toName: sub.name || undefined,
      subject: `[모투스] 건설·분양 위클리 ${ctx.date}`,
      html
    }, env, ctx.resendCfg)

    if (result.ok) {
      // 성공 → 멱등 로그 기록 (유니크 제약으로 중복 INSERT 시 무시)
      await recordEmailSend(db, {
        jobId,
        subscriberId: sub.id,
        recipient: sub.email,
        status: 'success',
        resendId: result.resendId,
        attempts: result.attempts,
        errorCode: 'OK'
      })
      // 기존 email_logs 호환 유지
      await logEmailSend(db, sub.id, sub.email, ctx.date, 'success')
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
        errorMessage: result.errorMessage
      })
      await logEmailSend(db, sub.id, sub.email, ctx.date, 'failed', errMsg)
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
      errorMessage: errMsg
    }).catch(() => {})
    await logEmailSend(db, sub.id, sub.email, ctx.date, 'failed', errMsg).catch(() => {})
    await incrementSendJobCounter(db, jobId, 'failed_count').catch(() => {})
    ctx.result.emailsFailed++
    ctx.result.errors.push(`${sub.email}: ${errMsg}`)
    ctx.progress.failed++
    ctx.progress.errors.push(`${sub.email}: ${errMsg}`)
  }
}
