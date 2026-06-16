// 발송 작업(Send Job) - 멱등성(Idempotency) 보장 모듈
// - 날짜별 고유 job_id로 락을 잡고, 동일 작업 중복 실행을 차단
// - 개별 구독자 단위로도 (job_id, subscriber_id) 유니크 인덱스를 통해 중복 발송 방지
//
// 사용:
//   const job = await acquireSendJob(db, 'cron')
//   if (!job) return  // 이미 완료/실행 중
//   await runSendJob(db, env, job, ...)

import { todayKST } from './utils'

export type SendJobStatus = 'pending' | 'running' | 'completed' | 'failed'
export type SendTrigger = 'cron' | 'manual' | 'cron-test'

export interface SendJob {
  job_id: string
  scheduled_date: string
  trigger_type: SendTrigger
  status: SendJobStatus
  started_at: string | null
  completed_at: string | null
  total_count: number
  success_count: number
  failed_count: number
  retry_count: number
  estimated_seconds: number
  error_message: string | null
  worker_token: string | null
  created_at: string
  updated_at: string
}

/** 날짜에서 job_id 생성 (일간) */
export function makeJobId(date: string): string {
  return `newsletter_${date}`
}

/** 위클리 job_id 생성 (week_start_date 기반) */
export function makeWeeklyJobId(weekStart: string): string {
  return `weekly_${weekStart}`
}

/** worker token (현재 인스턴스 식별자) */
function makeWorkerToken(): string {
  return `w_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/** job 조회 */
export async function getSendJob(db: D1Database, jobId: string): Promise<SendJob | null> {
  const r = await db.prepare(`SELECT * FROM send_jobs WHERE job_id = ?`).bind(jobId).first<SendJob>()
  return r || null
}

/**
 * 락 획득(Acquire):
 *   1) 같은 job_id가 'completed'면 null 반환 (중복 발송 차단)
 *      ※ force=true 이면 우회: 동일 row를 재사용하되 시각/카운터를 리셋하고 'running'으로 전이
 *   2) 'running'이면 락이 걸려 있으므로 null 반환 (force=true 이어도 동일 — race condition 차단 유지)
 *   3) 없거나 'failed'/'pending'이면 INSERT OR REPLACE로 status='running'으로 점유
 *
 * D1(SQLite)은 단일 명령 단위로 원자성이 보장된다. 다중 워커가 동시에 호출하더라도
 * UPDATE ... WHERE status != 'running' 패턴으로 race condition을 차단한다.
 *
 * @param force - true 이면 'completed' 상태도 우회하여 재발송 허용 (운영자 명시적 재발송 시)
 *                동일 job_id row를 재사용 (새 row INSERT 안 함) — 시각만 최신화, 카운터는 0으로 리셋.
 */
export async function acquireSendJob(
  db: D1Database,
  trigger: SendTrigger,
  date?: string,
  customJobId?: string,
  force: boolean = false,
): Promise<SendJob | null> {
  const scheduledDate = date || todayKST()
  const jobId = customJobId || makeJobId(scheduledDate)
  const startedAt = new Date().toISOString()
  const token = makeWorkerToken()

  // 1) 우선 row 없으면 INSERT (status=pending)
  await db.prepare(`
    INSERT OR IGNORE INTO send_jobs (job_id, scheduled_date, trigger_type, status, started_at, worker_token, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', NULL, NULL, ?, ?)
  `).bind(jobId, scheduledDate, trigger, startedAt, startedAt).run()

  // 2) 현재 상태 확인
  const cur = await getSendJob(db, jobId)
  if (!cur) {
    return null  // 이론상 발생 X
  }

  if (cur.status === 'completed') {
    if (!force) {
      console.log(`[SendJob] ${jobId} 는 이미 'completed' 상태 → 발송 중단 (멱등성 보호). force=true 옵션을 주면 재발송 가능.`)
      return null
    }
    // force=true: 운영자가 명시적으로 재발송을 원함 → 동일 row를 재사용 (카운터/시각 리셋)
    console.warn(`[SendJob] ${jobId} 'completed' 상태이지만 force=true → 재발송 진행 (이전 결과: ${cur.success_count}성공/${cur.failed_count}실패)`)
  }
  if (cur.status === 'running') {
    // 6시간 이상 묵힌 running은 dead lock으로 간주하고 재획득
    const age = cur.started_at ? (Date.now() - new Date(cur.started_at).getTime()) : 0
    if (age < 6 * 60 * 60 * 1000) {
      console.log(`[SendJob] ${jobId} 는 다른 인스턴스에서 'running' 상태 → 발송 중단 (락 보호). force=true 이어도 동시 발송은 차단됨.`)
      return null
    }
    console.warn(`[SendJob] ${jobId} 가 ${Math.floor(age / 60000)}분 째 'running' - dead lock 으로 간주, 재획득 시도`)
  }

  // 3) status = 'running' 으로 원자적 전이
  //    - force=true 이면 'completed' 도 허용 + 카운터를 0으로 리셋 (재발송 결과를 새로 집계)
  //    - completed_at / error_message 도 초기화하여 화면에서 "방금 재발송" 임이 명확히 보이도록
  let updRes
  if (force) {
    updRes = await db.prepare(`
      UPDATE send_jobs
      SET status = 'running',
          started_at = ?,
          completed_at = NULL,
          worker_token = ?,
          trigger_type = ?,
          success_count = 0,
          failed_count = 0,
          retry_count = 0,
          error_message = NULL,
          updated_at = ?
      WHERE job_id = ?
        AND status IN ('pending', 'failed', 'running', 'completed')
    `).bind(startedAt, token, trigger, startedAt, jobId).run()
  } else {
    updRes = await db.prepare(`
      UPDATE send_jobs
      SET status = 'running',
          started_at = ?,
          worker_token = ?,
          trigger_type = ?,
          updated_at = ?
      WHERE job_id = ?
        AND status IN ('pending', 'failed', 'running')
    `).bind(startedAt, token, trigger, startedAt, jobId).run()
  }

  if (!updRes.success || (updRes.meta.changes ?? 0) === 0) {
    console.log(`[SendJob] ${jobId} 락 획득 실패 (다른 워커가 점유 중)`)
    return null
  }

  // force 발송 시 기존 email_send_log 도 삭제하여 "이미 발송됨 스킵" 로직이
  // 모든 구독자를 새로 발송하도록 한다. (재발송의 의미상 필수)
  if (force) {
    const delRes = await db.prepare(`DELETE FROM email_send_log WHERE job_id = ?`).bind(jobId).run()
    console.log(`[SendJob] ${jobId} force 재발송: 기존 email_send_log ${delRes.meta.changes ?? 0}건 삭제 (모든 구독자 재발송 대상)`)
  }

  return await getSendJob(db, jobId)
}

/** total/예상 시간 미리 기록 */
export async function setSendJobPlan(
  db: D1Database,
  jobId: string,
  totalCount: number,
  estimatedSeconds: number
): Promise<void> {
  await db.prepare(`
    UPDATE send_jobs SET total_count = ?, estimated_seconds = ?, updated_at = ? WHERE job_id = ?
  `).bind(totalCount, estimatedSeconds, new Date().toISOString(), jobId).run()
}

/** 카운터 증가 (success / failed) */
export async function incrementSendJobCounter(
  db: D1Database,
  jobId: string,
  field: 'success_count' | 'failed_count'
): Promise<void> {
  await db.prepare(`
    UPDATE send_jobs SET ${field} = ${field} + 1, updated_at = ? WHERE job_id = ?
  `).bind(new Date().toISOString(), jobId).run()
}

/** 작업 종료 (status: completed/failed) */
export async function finalizeSendJob(
  db: D1Database,
  jobId: string,
  status: 'completed' | 'failed',
  errorMessage?: string
): Promise<void> {
  const now = new Date().toISOString()
  await db.prepare(`
    UPDATE send_jobs
    SET status = ?, completed_at = ?, error_message = ?, updated_at = ?
    WHERE job_id = ?
  `).bind(status, now, errorMessage || null, now, jobId).run()
}

/** 락 해제 (실행 중 예외 발생 시 status='failed' 로 표기) */
export async function releaseSendJob(db: D1Database, jobId: string, errorMessage: string): Promise<void> {
  await finalizeSendJob(db, jobId, 'failed', errorMessage)
}

// ============ email_send_log (구독자 단위 멱등성) ============

export interface EmailSendLog {
  id: number
  job_id: string
  subscriber_id: number | null
  recipient: string
  status: 'success' | 'failed'
  resend_id: string | null
  attempts: number
  error_code: string | null
  error_message: string | null
  sent_at: string
}

/** 해당 job에서 이미 발송 성공한 구독자 ID Set 반환 (재진입 시 skip) */
export async function getAlreadySentSubscriberIds(
  db: D1Database,
  jobId: string
): Promise<{ ids: Set<number>; emails: Set<string> }> {
  const r = await db.prepare(`
    SELECT subscriber_id, recipient FROM email_send_log
    WHERE job_id = ? AND status = 'success'
  `).bind(jobId).all<{ subscriber_id: number | null; recipient: string }>()

  const ids = new Set<number>()
  const emails = new Set<string>()
  for (const row of r.results) {
    if (row.subscriber_id != null) ids.add(row.subscriber_id)
    if (row.recipient) emails.add(row.recipient.toLowerCase())
  }
  return { ids, emails }
}

/**
 * 발송 결과 기록 (성공/실패 모두 호출):
 * - 유니크 인덱스로 (job_id, subscriber_id) 또는 (job_id, recipient) 중복 INSERT 시도하면 무시되고
 *   기존 row를 status에 따라 갱신.
 * - 즉, 동일 job 안에서 같은 구독자에게는 단 한 행만 존재 (멱등성).
 */
export async function recordEmailSend(
  db: D1Database,
  params: {
    jobId: string
    subscriberId: number | null
    recipient: string
    status: 'success' | 'failed'
    resendId?: string | null
    attempts?: number
    errorCode?: string | null
    errorMessage?: string | null
  }
): Promise<void> {
  // 우선 INSERT OR IGNORE
  const ins = await db.prepare(`
    INSERT OR IGNORE INTO email_send_log
      (job_id, subscriber_id, recipient, status, resend_id, attempts, error_code, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    params.jobId,
    params.subscriberId,
    params.recipient,
    params.status,
    params.resendId || null,
    params.attempts || 1,
    params.errorCode || null,
    params.errorMessage || null
  ).run()

  // 이미 row가 있다면 (재시도 후 성공 등) success 우선 갱신
  if ((ins.meta.changes ?? 0) === 0) {
    await db.prepare(`
      UPDATE email_send_log
      SET status = CASE WHEN status = 'success' THEN 'success' ELSE ? END,
          resend_id = COALESCE(?, resend_id),
          attempts = attempts + 1,
          error_code = ?,
          error_message = ?
      WHERE job_id = ?
        AND (
          (subscriber_id IS NOT NULL AND subscriber_id = ?)
          OR recipient = ?
        )
    `).bind(
      params.status,
      params.resendId || null,
      params.errorCode || null,
      params.errorMessage || null,
      params.jobId,
      params.subscriberId,
      params.recipient
    ).run()
  }
}

/** 발송 작업의 상세 로그 조회 */
export async function getEmailSendLogsByJob(
  db: D1Database,
  jobId: string
): Promise<EmailSendLog[]> {
  const r = await db.prepare(`
    SELECT * FROM email_send_log WHERE job_id = ? ORDER BY sent_at ASC, id ASC
  `).bind(jobId).all<EmailSendLog>()
  return r.results
}

/** 최근 send_jobs 목록 (관리자 페이지용) */
export async function listSendJobs(
  db: D1Database,
  limit: number = 30
): Promise<SendJob[]> {
  const r = await db.prepare(`
    SELECT * FROM send_jobs ORDER BY created_at DESC LIMIT ?
  `).bind(limit).all<SendJob>()
  return r.results
}

/** 실패한 구독자 목록 (특정 job) */
export async function getFailedRecipients(
  db: D1Database,
  jobId: string
): Promise<EmailSendLog[]> {
  const r = await db.prepare(`
    SELECT * FROM email_send_log
    WHERE job_id = ? AND status = 'failed'
    ORDER BY sent_at ASC
  `).bind(jobId).all<EmailSendLog>()
  return r.results
}
