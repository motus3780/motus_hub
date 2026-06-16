// 이메일 발송 (Resend 전용)

import { getSettings, SETTING_KEYS } from './settings'

export interface EmailMessage {
  to: string
  toName?: string
  subject: string
  html: string
  text?: string
}

export interface ResendConfig {
  apiKey: string
  senderName: string
  senderEmail: string
}

const DEFAULT_SENDER_EMAIL = 'onboarding@resend.dev'
const DEFAULT_SENDER_NAME = '모투스 위클리'

/**
 * Resend 설정 로드
 * 우선순위: 1) env.RESEND_API_KEY (Cloudflare 환경변수)
 *          2) settings 테이블의 resend_api_key
 * 발신자: settings의 sender_email (없으면 onboarding@resend.dev)
 */
export async function loadResendConfig(
  db: D1Database,
  env?: { RESEND_API_KEY?: string }
): Promise<ResendConfig> {
  const s = await getSettings(db, [
    SETTING_KEYS.RESEND_API_KEY,
    SETTING_KEYS.SENDER_NAME,
    SETTING_KEYS.SENDER_EMAIL
  ])
  const apiKey = (env?.RESEND_API_KEY || s[SETTING_KEYS.RESEND_API_KEY] || '').trim()
  const senderName = (s[SETTING_KEYS.SENDER_NAME] || DEFAULT_SENDER_NAME).trim()
  const senderEmail = (s[SETTING_KEYS.SENDER_EMAIL] || DEFAULT_SENDER_EMAIL).trim()
  return { apiKey, senderName, senderEmail }
}

/**
 * Resend로 이메일 발송. 실패 시 Resend의 응답 본문을 그대로 throw.
 * 응답에 status 코드를 포함하여 호출자가 429 등을 식별 가능.
 */
export class ResendError extends Error {
  status: number
  raw: string
  constructor(status: number, message: string, raw: string) {
    super(message)
    this.status = status
    this.raw = raw
  }
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function sendEmail(
  db: D1Database,
  msg: EmailMessage,
  env?: { RESEND_API_KEY?: string },
  cfgIn?: ResendConfig
): Promise<{ id?: string; raw: string }> {
  const cfg = cfgIn || await loadResendConfig(db, env)
  if (!cfg.apiKey) {
    throw new Error('Resend API 키가 설정되지 않았습니다. (환경변수 RESEND_API_KEY 또는 환경설정에서 입력)')
  }

  const fromHeader = `${cfg.senderName} <${cfg.senderEmail}>`
  // 메일 헤더의 Date 는 "Resend API에 요청을 던지는 시점" = 실제 발송 시점으로 명시 지정.
  // RFC 5322 / 2822 Date 형식 (e.g. "Sun, 15 Jun 2026 06:58:23 GMT")
  //  - 이 값을 명시적으로 보내지 않으면 Resend가 자동으로 본인 서버 시각을 찍는다.
  //  - 명시 지정함으로써 "콘텐츠 생성 시각이 메일 Date로 찍히는" 오해를 차단한다.
  //  - 메일 클라이언트는 Date 헤더가 UTC(=GMT) 이어도 사용자 로컬 타임존(KST)으로 변환해 표시한다.
  const sentAtUtc = new Date()
  const dateHeader = sentAtUtc.toUTCString()
  const payload: Record<string, any> = {
    from: fromHeader,
    to: [msg.to],
    subject: msg.subject,
    html: msg.html,
    headers: {
      // Resend는 payload.headers를 메일에 그대로 첨부함
      'Date': dateHeader,
    },
  }
  if (msg.text) payload.text = msg.text

  let res: Response
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${cfg.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
  } catch (e: any) {
    throw new Error(`Resend 네트워크 오류 (sentAt=${sentAtUtc.toISOString()}): ${e?.message || String(e)}`)
  }

  const rawText = await res.text()
  if (!res.ok) {
    // Resend의 응답 본문(에러 메시지)을 그대로 노출
    const message = `Resend ${res.status} ${res.statusText} | ${rawText || '(empty body)'}`
    throw new ResendError(res.status, message, rawText)
  }

  let id: string | undefined
  try {
    const data = JSON.parse(rawText)
    id = data?.id
  } catch {
    // JSON 파싱 실패 무시
  }
  return { id, raw: rawText }
}

/**
 * 응답 코드별 에러 분류
 *  - RATE_LIMIT (429): 2초 대기, 최대 3회 재시도
 *  - 5XX: 5초 대기, 최대 2회 재시도
 *  - NETWORK: 5초 대기, 최대 2회 재시도
 *  - 4XX (400/401/403/422): 재시도 X (영구 실패)
 *  - 200/201 OK: 성공
 */
export type SendErrorCode = 'OK' | 'RATE_LIMIT' | '4XX' | '5XX' | 'NETWORK' | 'CONFIG'

export interface SendAttemptResult {
  ok: boolean
  resendId?: string
  attempts: number
  errorCode: SendErrorCode
  errorMessage?: string
  raw?: string
}

function classifyError(e: any): { code: SendErrorCode; status?: number } {
  if (e instanceof ResendError) {
    if (e.status === 429) return { code: 'RATE_LIMIT', status: 429 }
    if (e.status >= 500) return { code: '5XX', status: e.status }
    if (e.status >= 400) return { code: '4XX', status: e.status }
  }
  // 네트워크 / 기타
  const msg = String(e?.message || e || '')
  if (/network|fetch|timeout|ECONNRESET|ETIMEDOUT/i.test(msg)) return { code: 'NETWORK' }
  return { code: 'NETWORK' }
}

/**
 * 응답 코드별 분기 재시도 발송:
 *  - 200/201: 즉시 성공 반환
 *  - 429    : 2초 대기, 최대 3회
 *  - 5xx    : 5초 대기, 최대 2회
 *  - 4xx    : 재시도 없이 실패
 *  - 네트워크: 5초 대기, 최대 2회
 *
 * 발송 결과를 throw 대신 객체로 반환한다 (호출자가 멱등성 로그를 쉽게 기록).
 */
export async function sendEmailWithRetry(
  db: D1Database,
  msg: EmailMessage,
  env?: { RESEND_API_KEY?: string },
  cfgIn?: ResendConfig
): Promise<SendAttemptResult> {
  let attempts = 0
  let lastErr: any = null
  let lastCode: SendErrorCode = 'OK'

  // 시도 가능한 최대 횟수 (가장 관대한 케이스 기준)
  const HARD_MAX = 3

  while (attempts < HARD_MAX) {
    attempts++
    try {
      const r = await sendEmail(db, msg, env, cfgIn)
      return { ok: true, resendId: r.id, attempts, errorCode: 'OK', raw: r.raw }
    } catch (e: any) {
      lastErr = e
      const cls = classifyError(e)
      lastCode = cls.code

      // 4XX 또는 CONFIG는 즉시 실패
      if (cls.code === '4XX' || cls.code === 'CONFIG') {
        return {
          ok: false,
          attempts,
          errorCode: cls.code,
          errorMessage: e?.message || String(e),
        }
      }

      // 코드별 재시도 한도 결정
      let maxAttempts: number
      let waitMs: number
      if (cls.code === 'RATE_LIMIT') {
        maxAttempts = 3
        waitMs = 2000
      } else if (cls.code === '5XX') {
        maxAttempts = 2
        waitMs = 5000
      } else {
        // NETWORK
        maxAttempts = 2
        waitMs = 5000
      }

      if (attempts >= maxAttempts) {
        // 더 이상 재시도하지 않음
        return {
          ok: false,
          attempts,
          errorCode: cls.code,
          errorMessage: e?.message || String(e),
        }
      }

      console.warn(`[sendEmailWithRetry] ${cls.code} (${cls.status || '-'}) - ${waitMs}ms 후 재시도 (${attempts}/${maxAttempts}): ${msg.to}`)
      await sleep(waitMs)
    }
  }

  return {
    ok: false,
    attempts,
    errorCode: lastCode,
    errorMessage: lastErr?.message || String(lastErr),
  }
}

// 발송 로그 기록 (실패 시 원문 응답 보존)
export async function logEmailSend(
  db: D1Database,
  subscriberId: number | null,
  recipient: string,
  date: string,
  status: 'success' | 'failed',
  errorMessage?: string
): Promise<void> {
  await db.prepare(`
    INSERT INTO email_logs (subscriber_id, recipient, send_date, status, error_message)
    VALUES (?, ?, ?, ?, ?)
  `).bind(subscriberId, recipient, date, status, errorMessage || null).run()
}
