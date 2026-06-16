// 자동 실행 (Cron) 관련 유틸 + 로그 + 재시도 + 실패 알림

import type { Bindings } from './types'
import { getSetting, getSettings, setSetting, SETTING_KEYS, AUTO_DEFAULTS, isWeeklyModeEnabled, getWeeklySendTime } from './settings'
import { runDailyJob, type DailyJobResult } from './dailyJob'
import { runWeeklyJob, type WeeklyJobResult } from './weeklyJob'
import { getNewsByDate } from './news'
import { sendEmail } from './email'
import { todayKST, nowKST, nowUtcIso, getLastWeekRange } from './utils'

// ============ 자동 실행 설정 로드 ============
export interface AutoJobConfig {
  collectEnabled: boolean
  sendEnabled: boolean
  collectTime: string  // 'HH:MM' (KST)
  sendTime: string     // 'HH:MM' (KST)
  adminEmail: string
}

export async function loadAutoJobConfig(db: D1Database): Promise<AutoJobConfig> {
  const s = await getSettings(db, [
    SETTING_KEYS.AUTO_COLLECT_ENABLED,
    SETTING_KEYS.AUTO_SEND_ENABLED,
    SETTING_KEYS.AUTO_COLLECT_TIME_KST,
    SETTING_KEYS.AUTO_SEND_TIME_KST,
    SETTING_KEYS.ADMIN_ALERT_EMAIL,
  ])
  return {
    collectEnabled: (s[SETTING_KEYS.AUTO_COLLECT_ENABLED] ?? '1') === '1',
    sendEnabled: (s[SETTING_KEYS.AUTO_SEND_ENABLED] ?? '1') === '1',
    collectTime: s[SETTING_KEYS.AUTO_COLLECT_TIME_KST] || AUTO_DEFAULTS.COLLECT_TIME,
    sendTime: s[SETTING_KEYS.AUTO_SEND_TIME_KST] || AUTO_DEFAULTS.SEND_TIME,
    adminEmail: s[SETTING_KEYS.ADMIN_ALERT_EMAIL] || AUTO_DEFAULTS.ADMIN_EMAIL,
  }
}

// ============ 시각 검증 ============
export function parseTimeHHMM(s: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s || '').trim())
  if (!m) return null
  const h = parseInt(m[1], 10)
  const mi = parseInt(m[2], 10)
  if (isNaN(h) || h < 0 || h > 23 || isNaN(mi) || mi < 0 || mi > 59) return null
  return { h, m: mi }
}

/** 발송 시각이 수집 시각보다 30분 이후인지 검증 */
export function validateAutoTimes(collectTime: string, sendTime: string): { ok: boolean; error?: string } {
  const c = parseTimeHHMM(collectTime)
  const s = parseTimeHHMM(sendTime)
  if (!c) return { ok: false, error: '수집·요약 시각 형식이 올바르지 않습니다 (HH:MM)' }
  if (!s) return { ok: false, error: '발송 시각 형식이 올바르지 않습니다 (HH:MM)' }
  const cmin = c.h * 60 + c.m
  const smin = s.h * 60 + s.m
  if (smin - cmin < 30) {
    return { ok: false, error: '발송 시각은 수집·요약 시각보다 최소 30분 이후여야 합니다.' }
  }
  return { ok: true }
}

// ============ 다음 실행 예정 시각 (KST) ============
/** 'YYYY-MM-DD HH:MM KST' 형태로 다음 실행 시각 반환 */
export function getNextRunKST(timeHHMM: string): string {
  const t = parseTimeHHMM(timeHHMM) || { h: 6, m: 30 }
  const k = nowKST() // KST로 보정된 Date (UTC메서드로 KST 값 읽음)
  const todayY = k.getUTCFullYear()
  const todayM = k.getUTCMonth()
  const todayD = k.getUTCDate()
  const nowMin = k.getUTCHours() * 60 + k.getUTCMinutes()
  const targetMin = t.h * 60 + t.m

  let runDate = new Date(Date.UTC(todayY, todayM, todayD, t.h, t.m))
  if (nowMin >= targetMin) {
    // 이미 지났으면 내일
    runDate = new Date(runDate.getTime() + 24 * 60 * 60 * 1000)
  }
  const yyyy = runDate.getUTCFullYear()
  const mm = String(runDate.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(runDate.getUTCDate()).padStart(2, '0')
  const hh = String(t.h).padStart(2, '0')
  const mi = String(t.m).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} KST`
}

// ============ 자동 실행 로그 ============
// 'send'는 일간 발송 (현재 cron에서 폐지됨, 관리자 수동 발송용으로만 유지)
// 'weekly_send'는 위클리 발송 (월요일 07:00 KST cron)
export type JobType = 'collect' | 'send' | 'weekly_send'
export type JobStatus = 'success' | 'failed' | 'skipped' | 'partial'
export type TriggerType = 'cron' | 'manual' | 'cron-test'

export interface AutoJobLog {
  id: number
  job_type: JobType
  trigger_type: TriggerType
  status: JobStatus
  started_at: string
  finished_at: string | null
  attempt: number
  news_collected: number
  emails_sent: number
  emails_failed: number
  error_message: string | null
  result_json: string | null
  created_at: string
}

export async function insertAutoJobLog(
  db: D1Database,
  log: Omit<AutoJobLog, 'id' | 'created_at'>
): Promise<number> {
  const r = await db.prepare(`
    INSERT INTO auto_job_logs (
      job_type, trigger_type, status, started_at, finished_at, attempt,
      news_collected, emails_sent, emails_failed, error_message, result_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    log.job_type, log.trigger_type, log.status, log.started_at, log.finished_at,
    log.attempt, log.news_collected, log.emails_sent, log.emails_failed,
    log.error_message, log.result_json
  ).run()
  return r.meta.last_row_id as number
}

export async function getLastAutoJobLog(db: D1Database, jobType: JobType): Promise<AutoJobLog | null> {
  const r = await db.prepare(`
    SELECT * FROM auto_job_logs WHERE job_type = ? ORDER BY started_at DESC LIMIT 1
  `).bind(jobType).first<AutoJobLog>()
  return r || null
}

export async function getAutoJobLogs(db: D1Database, limit: number = 50): Promise<AutoJobLog[]> {
  const r = await db.prepare(`
    SELECT * FROM auto_job_logs ORDER BY started_at DESC LIMIT ?
  `).bind(limit).all<AutoJobLog>()
  return r.results
}

/** 오늘(KST) 자동 수집/발송이 이미 성공했는지 확인 */
export async function hasCompletedToday(db: D1Database, jobType: JobType): Promise<boolean> {
  const today = todayKST()
  const r = await db.prepare(`
    SELECT id FROM auto_job_logs
    WHERE job_type = ?
      AND status IN ('success', 'partial')
      AND substr(started_at, 1, 10) = ?
    LIMIT 1
  `).bind(jobType, today).first()
  return !!r
}

/**
 * 이번 주(이번 호) 위클리 발송이 이미 성공했는지 확인
 * - 발송 기준일(referenceDate, 오늘) 기준 직전 주(월~일) 범위를 계산
 * - week_start_date(직전 주 월요일)에 해당하는 weekly_send 로그가 success/partial 이면 true
 *
 * weekly_summaries.week_start_date를 키로 사용하며, result_json에 weekStart가 들어가는데
 * 더 안전하게 발송일(이번 주 월요일 = issueDate) 기준 같은 날짜에 성공 로그가 있는지로 판정합니다.
 */
export async function hasCompletedThisWeek(db: D1Database, referenceDate?: Date): Promise<boolean> {
  const { issueDate } = getLastWeekRange(referenceDate)
  // 이번 주 월요일(issueDate)에 발화한 weekly_send 로그가 이미 성공했다면 skip
  const r = await db.prepare(`
    SELECT id FROM auto_job_logs
    WHERE job_type = 'weekly_send'
      AND status IN ('success', 'partial')
      AND substr(started_at, 1, 10) = ?
    LIMIT 1
  `).bind(issueDate).first()
  return !!r
}

// ============ 재시도 래퍼 ============
const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 5 * 60 * 1000  // 5분

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

export interface RetryResult<T> {
  ok: boolean
  attempts: number
  result?: T
  error?: string
  errorHistory: string[]
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; delayMs?: number; label?: string } = {}
): Promise<RetryResult<T>> {
  const max = opts.maxAttempts ?? MAX_ATTEMPTS
  const delay = opts.delayMs ?? RETRY_DELAY_MS
  const errors: string[] = []
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      const r = await fn()
      return { ok: true, attempts: attempt, result: r, errorHistory: errors }
    } catch (e: any) {
      const msg = e?.message || String(e)
      errors.push(`[${attempt}/${max}] ${msg}`)
      console.error(`[withRetry${opts.label ? ' ' + opts.label : ''}] attempt ${attempt}/${max} 실패:`, msg)
      if (attempt < max) {
        await sleep(delay)
      }
    }
  }
  return { ok: false, attempts: max, error: errors[errors.length - 1], errorHistory: errors }
}

// ============ 실패 알림 메일 ============
export async function sendFailureAlert(
  db: D1Database,
  env: { RESEND_API_KEY?: string },
  opts: {
    stage: '수집·요약' | '발송'
    errorMessage: string
    errorHistory: string[]
    siteUrl?: string
    adminEmail: string
  }
): Promise<void> {
  const failedAt = nowUtcIso()
  const siteUrl = opts.siteUrl || ''
  const retryLink = siteUrl ? `${siteUrl}/admin/dashboard` : '/admin/dashboard'
  const histHtml = opts.errorHistory.map(e => `<li>${escapeHtmlLocal(e)}</li>`).join('')
  const html = `
    <!DOCTYPE html>
    <html lang="ko"><head><meta charset="UTF-8"></head>
    <body style="font-family:'Pretendard','Apple SD Gothic Neo',sans-serif;background:#f4f6f8;padding:24px;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,0.06);">
        <div style="background:#e74c3c;color:#fff;padding:24px;">
          <div style="font-size:13px;opacity:0.9;">자동 실행 실패 알림</div>
          <div style="font-size:22px;font-weight:800;margin-top:6px;">⚠️ ${escapeHtmlLocal(opts.stage)} 단계 실패</div>
        </div>
        <div style="padding:24px;color:#2c3e50;line-height:1.7;">
          <div style="margin-bottom:14px;">
            <strong>실패 시각</strong>: ${escapeHtmlLocal(failedAt)} KST<br>
            <strong>실패 단계</strong>: ${escapeHtmlLocal(opts.stage)}<br>
            <strong>최종 오류</strong>: <code style="background:#fff5f5;color:#c0392b;padding:2px 6px;border-radius:4px;">${escapeHtmlLocal(opts.errorMessage)}</code>
          </div>
          <div style="background:#f8fafc;padding:14px;border-radius:8px;font-size:13px;">
            <strong>재시도 이력</strong> (5분 간격, 최대 3회)
            <ul style="margin:8px 0 0;padding-left:20px;">${histHtml}</ul>
          </div>
          <div style="text-align:center;margin-top:24px;">
            <a href="${retryLink}" style="display:inline-block;padding:12px 24px;background:#2c3e50;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">관리자 페이지에서 수동 재실행 →</a>
          </div>
        </div>
        <div style="background:#2c3e50;color:#bdc3c7;padding:14px 24px;font-size:12px;text-align:center;">
          모투스 위클리 — 자동 실행 모니터링
        </div>
      </div>
    </body></html>`

  await sendEmail(db, {
    to: opts.adminEmail,
    subject: `[⚠️ 자동실행 실패] ${opts.stage} - ${failedAt} KST`,
    html
  }, env).catch(err => {
    console.error('[FailureAlert] 알림 메일 발송 실패:', err?.message || err)
  })
}

function escapeHtmlLocal(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// ============ 자동 수집·요약 작업 ============
/**
 * 자동 수집·요약 실행 (재시도 + 알림 포함)
 * - 이미 오늘 성공 로그가 있으면 skip
 */
export async function runAutoCollect(
  db: D1Database,
  env: { RESEND_API_KEY?: string },
  triggerType: TriggerType = 'cron'
): Promise<AutoJobLog> {
  const startedAt = nowUtcIso()
  const today = todayKST()

  // 중복 실행 방지
  if (triggerType === 'cron') {
    const already = await hasCompletedToday(db, 'collect')
    if (already) {
      const id = await insertAutoJobLog(db, {
        job_type: 'collect',
        trigger_type: triggerType,
        status: 'skipped',
        started_at: startedAt,
        finished_at: nowUtcIso(),
        attempt: 1,
        news_collected: 0,
        emails_sent: 0,
        emails_failed: 0,
        error_message: '오늘 이미 수집·요약이 완료되어 skip 됨',
        result_json: null,
      })
      return (await getLastAutoJobLog(db, 'collect'))!
    }
  }

  // 재시도 (수집 + 요약)
  const retry = await withRetry<DailyJobResult>(
    () => runDailyJob(db, { skipSend: true }, env),
    { label: 'auto-collect' }
  )

  const finishedAt = nowUtcIso()

  if (retry.ok && retry.result) {
    const r = retry.result
    const status: JobStatus = (r.errors && r.errors.length > 0) ? 'partial' : 'success'
    const errMsg = (r.errors && r.errors.length > 0) ? r.errors.join(' | ') : null
    await insertAutoJobLog(db, {
      job_type: 'collect',
      trigger_type: triggerType,
      status,
      started_at: startedAt,
      finished_at: finishedAt,
      attempt: retry.attempts,
      news_collected: r.newsCollected || 0,
      emails_sent: 0,
      emails_failed: 0,
      error_message: errMsg,
      result_json: JSON.stringify(r),
    })
  } else {
    await insertAutoJobLog(db, {
      job_type: 'collect',
      trigger_type: triggerType,
      status: 'failed',
      started_at: startedAt,
      finished_at: finishedAt,
      attempt: retry.attempts,
      news_collected: 0,
      emails_sent: 0,
      emails_failed: 0,
      error_message: retry.error || 'unknown error',
      result_json: JSON.stringify({ errorHistory: retry.errorHistory }),
    })
    // 실패 알림
    const cfg = await loadAutoJobConfig(db)
    const siteUrl = await getSetting(db, SETTING_KEYS.SITE_URL).catch(() => null)
    await sendFailureAlert(db, env, {
      stage: '수집·요약',
      errorMessage: retry.error || 'unknown error',
      errorHistory: retry.errorHistory,
      siteUrl: siteUrl || undefined,
      adminEmail: cfg.adminEmail,
    })
  }

  return (await getLastAutoJobLog(db, 'collect'))!
}

// ============ 자동 발송 작업 ============
/**
 * 자동 발송 실행 (재시도 + 알림 포함)
 * - 오늘 수집된 뉴스가 없으면 중단 + 관리자 알림
 * - 이미 오늘 성공 로그가 있으면 skip
 */
export async function runAutoSend(
  db: D1Database,
  env: { RESEND_API_KEY?: string },
  triggerType: TriggerType = 'cron'
): Promise<AutoJobLog> {
  const startedAt = nowUtcIso()
  const today = todayKST()

  // 중복 실행 방지
  if (triggerType === 'cron') {
    const already = await hasCompletedToday(db, 'send')
    if (already) {
      await insertAutoJobLog(db, {
        job_type: 'send',
        trigger_type: triggerType,
        status: 'skipped',
        started_at: startedAt,
        finished_at: nowUtcIso(),
        attempt: 1,
        news_collected: 0,
        emails_sent: 0,
        emails_failed: 0,
        error_message: '오늘 이미 발송이 완료되어 skip 됨',
        result_json: null,
      })
      return (await getLastAutoJobLog(db, 'send'))!
    }
  }

  // 오늘 뉴스가 있는지 확인 (없으면 중단 + 알림)
  const news = await getNewsByDate(db, today).catch(() => [])
  if (!news || news.length === 0) {
    const errMsg = `오늘(${today}) 수집된 뉴스가 없습니다. 발송을 중단합니다.`
    await insertAutoJobLog(db, {
      job_type: 'send',
      trigger_type: triggerType,
      status: 'failed',
      started_at: startedAt,
      finished_at: nowUtcIso(),
      attempt: 1,
      news_collected: 0,
      emails_sent: 0,
      emails_failed: 0,
      error_message: errMsg,
      result_json: null,
    })
    const cfg = await loadAutoJobConfig(db)
    const siteUrl = await getSetting(db, SETTING_KEYS.SITE_URL).catch(() => null)
    await sendFailureAlert(db, env, {
      stage: '발송',
      errorMessage: errMsg,
      errorHistory: [errMsg],
      siteUrl: siteUrl || undefined,
      adminEmail: cfg.adminEmail,
    })
    return (await getLastAutoJobLog(db, 'send'))!
  }

  // === 발송은 멱등성 락(send_jobs)으로 보호되므로 외부 재시도 없이 1회만 실행 ===
  // 이전에는 withRetry로 5분 간격 3회 재시도하면서 일부 성공한 메일이 다시 발송되는
  // 중복 발송 버그가 있었음. 멱등성 로그(email_send_log)로 개별 구독자 단위 재진입은 안전.
  const finishedAtRunStart = nowUtcIso()
  let dailyResult: DailyJobResult | null = null
  let runError: string | null = null
  try {
    dailyResult = await runDailyJob(db, { skipCollect: true, trigger: triggerType }, env)
  } catch (e: any) {
    runError = e?.message || String(e)
    console.error('[runAutoSend] runDailyJob 예외:', runError)
  }

  const finishedAt = nowUtcIso()

  if (dailyResult) {
    const r = dailyResult
    const status: JobStatus = r.alreadyCompleted
      ? 'skipped'
      : (r.emailsFailed > 0 && r.emailsSent === 0)
        ? 'failed'
        : (r.emailsFailed > 0 ? 'partial' : 'success')
    const errMsg = (r.errors && r.errors.length > 0) ? r.errors.join(' | ') : null
    await insertAutoJobLog(db, {
      job_type: 'send',
      trigger_type: triggerType,
      status,
      started_at: startedAt,
      finished_at: finishedAt,
      attempt: 1,
      news_collected: 0,
      emails_sent: r.emailsSent || 0,
      emails_failed: r.emailsFailed || 0,
      error_message: errMsg,
      result_json: JSON.stringify(r),
    })
    if (status === 'failed') {
      const cfg = await loadAutoJobConfig(db)
      const siteUrl = await getSetting(db, SETTING_KEYS.SITE_URL).catch(() => null)
      await sendFailureAlert(db, env, {
        stage: '발송',
        errorMessage: errMsg || '모든 구독자 발송 실패',
        errorHistory: r.errors || [],
        siteUrl: siteUrl || undefined,
        adminEmail: cfg.adminEmail,
      })
    }
  } else {
    await insertAutoJobLog(db, {
      job_type: 'send',
      trigger_type: triggerType,
      status: 'failed',
      started_at: startedAt,
      finished_at: finishedAt,
      attempt: 1,
      news_collected: 0,
      emails_sent: 0,
      emails_failed: 0,
      error_message: runError || 'unknown error',
      result_json: JSON.stringify({ runError }),
    })
    const cfg = await loadAutoJobConfig(db)
    const siteUrl = await getSetting(db, SETTING_KEYS.SITE_URL).catch(() => null)
    await sendFailureAlert(db, env, {
      stage: '발송',
      errorMessage: runError || 'unknown error',
      errorHistory: [runError || 'unknown error'],
      siteUrl: siteUrl || undefined,
      adminEmail: cfg.adminEmail,
    })
  }

  return (await getLastAutoJobLog(db, 'send'))!
}

// ============ 자동 위클리 발송 작업 ============
/**
 * 자동 위클리 발송 실행 (재시도 X, 멱등성 보호)
 * - 이번 주(이번 호) 이미 성공 로그가 있으면 skip
 * - WEEKLY_MODE_ENABLED 가드: false면 skip
 * - runWeeklyJob 내부에 send_jobs 멱등성 락이 있어 외부 재시도 없이 1회만 실행
 *
 * Cron 호출 시점: 매주 월요일 KST 07:00 (UTC 일 22:00)
 */
export async function runAutoWeeklySend(
  db: D1Database,
  env: { RESEND_API_KEY?: string },
  triggerType: TriggerType = 'cron'
): Promise<AutoJobLog> {
  const startedAt = nowUtcIso()

  // 안전 가드: 위클리 모드 비활성 시 skip
  const weeklyEnabled = await isWeeklyModeEnabled(db)
  if (!weeklyEnabled && triggerType === 'cron') {
    await insertAutoJobLog(db, {
      job_type: 'weekly_send',
      trigger_type: triggerType,
      status: 'skipped',
      started_at: startedAt,
      finished_at: nowUtcIso(),
      attempt: 1,
      news_collected: 0,
      emails_sent: 0,
      emails_failed: 0,
      error_message: 'WEEKLY_MODE_ENABLED=false (위클리 모드 비활성 → skip)',
      result_json: null,
    })
    return (await getLastAutoJobLog(db, 'weekly_send'))!
  }

  // 중복 실행 방지 (이번 주에 이미 성공한 로그가 있는지)
  if (triggerType === 'cron') {
    const already = await hasCompletedThisWeek(db)
    if (already) {
      await insertAutoJobLog(db, {
        job_type: 'weekly_send',
        trigger_type: triggerType,
        status: 'skipped',
        started_at: startedAt,
        finished_at: nowUtcIso(),
        attempt: 1,
        news_collected: 0,
        emails_sent: 0,
        emails_failed: 0,
        error_message: '이번 주 위클리 발송이 이미 완료되어 skip 됨',
        result_json: null,
      })
      return (await getLastAutoJobLog(db, 'weekly_send'))!
    }
  }

  // === 위클리 잡 실행 (멱등성 락으로 보호되므로 외부 재시도 없이 1회만) ===
  let weeklyResult: WeeklyJobResult | null = null
  let runError: string | null = null
  try {
    weeklyResult = await runWeeklyJob(db, { trigger: triggerType }, env)
  } catch (e: any) {
    runError = e?.message || String(e)
    console.error('[runAutoWeeklySend] runWeeklyJob 예외:', runError)
  }

  const finishedAt = nowUtcIso()

  if (weeklyResult) {
    const r = weeklyResult
    const status: JobStatus = r.alreadyCompleted
      ? 'skipped'
      : (r.emailsFailed > 0 && r.emailsSent === 0)
        ? 'failed'
        : (r.emailsFailed > 0 ? 'partial' : 'success')
    const errMsg = (r.errors && r.errors.length > 0) ? r.errors.join(' | ') : null
    await insertAutoJobLog(db, {
      job_type: 'weekly_send',
      trigger_type: triggerType,
      status,
      started_at: startedAt,
      finished_at: finishedAt,
      attempt: 1,
      news_collected: r.articleCount || 0,
      emails_sent: r.emailsSent || 0,
      emails_failed: r.emailsFailed || 0,
      error_message: errMsg,
      result_json: JSON.stringify(r),
    })
    if (status === 'failed') {
      const cfg = await loadAutoJobConfig(db)
      const siteUrl = await getSetting(db, SETTING_KEYS.SITE_URL).catch(() => null)
      await sendFailureAlert(db, env, {
        stage: '발송',
        errorMessage: errMsg || '위클리 발송 실패 (모든 구독자)',
        errorHistory: r.errors || [],
        siteUrl: siteUrl || undefined,
        adminEmail: cfg.adminEmail,
      })
    }
  } else {
    await insertAutoJobLog(db, {
      job_type: 'weekly_send',
      trigger_type: triggerType,
      status: 'failed',
      started_at: startedAt,
      finished_at: finishedAt,
      attempt: 1,
      news_collected: 0,
      emails_sent: 0,
      emails_failed: 0,
      error_message: runError || 'unknown error',
      result_json: JSON.stringify({ runError }),
    })
    const cfg = await loadAutoJobConfig(db)
    const siteUrl = await getSetting(db, SETTING_KEYS.SITE_URL).catch(() => null)
    await sendFailureAlert(db, env, {
      stage: '발송',
      errorMessage: runError || 'unknown error',
      errorHistory: [runError || 'unknown error'],
      siteUrl: siteUrl || undefined,
      adminEmail: cfg.adminEmail,
    })
  }

  return (await getLastAutoJobLog(db, 'weekly_send'))!
}

// ============ Cron 분기 (시각 매칭) ============
/**
 * 현재 KST 요일/시각이 설정된 자동 실행 시각과 일치하는지 검사하여
 * 적절한 작업을 실행한다. (Cron이 매분 발화한다고 가정해도 안전)
 *
 * 분기 우선순위:
 *   1. 월요일 KST + 위클리 발송 시각(기본 07:00) 매칭 → runAutoWeeklySend
 *   2. 매일 KST 수집 시각 매칭 → runAutoCollect
 *   3. (legacy) 매일 KST 일간 발송 시각 매칭 → runAutoSend
 *      ※ wrangler.jsonc cron에서는 일간 발송이 제거되었으므로
 *        보통 이 분기는 실행되지 않으며, 수동 cron-test나 향후 옵션 복구 시에만 동작합니다.
 *
 * 매칭 허용 오차: ±2분 (Cron 발화 지연 흡수, 멱등성 락이 중복 실행 방지)
 */
export async function runScheduledByTime(
  db: D1Database,
  env: { RESEND_API_KEY?: string }
): Promise<{ executed: 'collect' | 'send' | 'weekly_send' | 'none'; log?: AutoJobLog }> {
  const cfg = await loadAutoJobConfig(db)
  const k = nowKST()
  const hh = String(k.getUTCHours()).padStart(2, '0')
  const mm = String(k.getUTCMinutes()).padStart(2, '0')
  const dow = k.getUTCDay()  // 0=일, 1=월, ..., 6=토 (KST 요일)
  const cur = `${hh}:${mm}`

  const curMin = parseInt(hh, 10) * 60 + parseInt(mm, 10)
  const cMin = (parseTimeHHMM(cfg.collectTime)?.h || 0) * 60 + (parseTimeHHMM(cfg.collectTime)?.m || 0)
  const sMin = (parseTimeHHMM(cfg.sendTime)?.h || 0) * 60 + (parseTimeHHMM(cfg.sendTime)?.m || 0)

  // 1) 위클리 발송: 월요일 KST + 위클리 발송 시각 (기본 07:00)
  if (dow === 1) {
    const weeklyTime = await getWeeklySendTime(db)
    const wMinParts = parseTimeHHMM(weeklyTime)
    const wMin = (wMinParts?.h || 7) * 60 + (wMinParts?.m || 0)
    if (Math.abs(curMin - wMin) <= 2) {
      console.log(`[Cron] KST 월요일 ${cur} ≈ weekly_send ${weeklyTime} → runAutoWeeklySend 호출`)
      const log = await runAutoWeeklySend(db, env, 'cron')
      return { executed: 'weekly_send', log }
    }
  }

  // 2) 일간 수집 (매일)
  if (cfg.collectEnabled && Math.abs(curMin - cMin) <= 2) {
    console.log(`[Cron] KST ${cur} ≈ collect ${cfg.collectTime} → runAutoCollect 호출`)
    const log = await runAutoCollect(db, env, 'cron')
    return { executed: 'collect', log }
  }

  // 3) (legacy) 일간 발송 — wrangler.jsonc에서 cron 제거되어 일반적으로 미발화
  if (cfg.sendEnabled && Math.abs(curMin - sMin) <= 2) {
    console.log(`[Cron] KST ${cur} ≈ send ${cfg.sendTime} → runAutoSend 호출 (legacy)`)
    const log = await runAutoSend(db, env, 'cron')
    return { executed: 'send', log }
  }

  const dayLabel = ['일', '월', '화', '수', '목', '금', '토'][dow]
  console.log(`[Cron] KST ${dayLabel}요일 ${cur} 가 어떤 작업 시각과도 일치하지 않음 (collect=${cfg.collectTime}, send=${cfg.sendTime}, weekly=월 ${await getWeeklySendTime(db).catch(() => '07:00')})`)
  return { executed: 'none' }
}
