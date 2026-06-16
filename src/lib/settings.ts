// 환경설정 저장/조회

import type { Bindings } from './types'

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>()
  return row?.value ?? null
}

export async function getSettings(db: D1Database, keys: string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {}
  const placeholders = keys.map(() => '?').join(',')
  const result = await db.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
    .bind(...keys).all<{ key: string; value: string }>()
  const out: Record<string, string> = {}
  for (const row of result.results) out[row.key] = row.value
  return out
}

export async function getAllSettings(db: D1Database): Promise<Record<string, string>> {
  const result = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>()
  const out: Record<string, string> = {}
  for (const row of result.results) out[row.key] = row.value
  return out
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).bind(key, value).run()
}

export async function setSettings(db: D1Database, kv: Record<string, string>): Promise<void> {
  for (const [k, v] of Object.entries(kv)) {
    await setSetting(db, k, v)
  }
}

// 셋업 완료 여부
export async function isSetupComplete(db: D1Database): Promise<boolean> {
  const v = await getSetting(db, 'setup_completed')
  return v === '1'
}

// 키 정의 (Resend 전용)
export const SETTING_KEYS = {
  NAVER_CLIENT_ID: 'naver_client_id',
  NAVER_CLIENT_SECRET: 'naver_client_secret',
  CLAUDE_API_KEY: 'claude_api_key',
  CLAUDE_MODEL: 'claude_model',
  RESEND_API_KEY: 'resend_api_key',
  SENDER_NAME: 'sender_name',
  SENDER_EMAIL: 'sender_email',
  COMPANY_LOGO_URL: 'company_logo_url',
  SITE_URL: 'site_url',
  SETUP_COMPLETED: 'setup_completed',
  SEND_HOUR_KST: 'send_hour_kst',
  // === 자동 실행 (Cron) 관련 ===
  AUTO_COLLECT_ENABLED: 'auto_collect_enabled',     // '1' | '0'  (기본 '1')
  AUTO_SEND_ENABLED: 'auto_send_enabled',           // '1' | '0'  (기본 '1')
  AUTO_COLLECT_TIME_KST: 'auto_collect_time_kst',   // 'HH:MM'   (기본 '06:30')
  AUTO_SEND_TIME_KST: 'auto_send_time_kst',         // 'HH:MM'   (기본 '07:30')
  ADMIN_ALERT_EMAIL: 'admin_alert_email',           // 실패 알림 수신 이메일
  // === 위클리 (Weekly) 관련 ===
  WEEKLY_MODE_ENABLED: 'weekly_mode_enabled',       // 'true' | 'false' (안전 가드)
  WEEKLY_SEND_TIME: 'weekly_send_time',             // 'HH:MM' (기본 '07:00', 월요일 KST)
  WEEKLY_VOL_COUNTER: 'weekly_vol_counter',         // 다음 VOL 번호 = COUNTER + 1
} as const

// 자동 실행 기본값
export const AUTO_DEFAULTS = {
  COLLECT_TIME: '06:30',
  SEND_TIME: '07:30',
  ADMIN_EMAIL: 'seokjun7127@gmail.com',
  WEEKLY_SEND_TIME: '07:00',
} as const

// ──────────────────────────────────────────────────────────────────────
// 위클리 모드 / VOL 카운터 헬퍼
// ──────────────────────────────────────────────────────────────────────

export async function isWeeklyModeEnabled(db: D1Database): Promise<boolean> {
  const v = await getSetting(db, SETTING_KEYS.WEEKLY_MODE_ENABLED)
  return v === 'true'
}

export async function setWeeklyModeEnabled(db: D1Database, enabled: boolean): Promise<void> {
  await setSetting(db, SETTING_KEYS.WEEKLY_MODE_ENABLED, enabled ? 'true' : 'false')
}

export async function getWeeklySendTime(db: D1Database): Promise<string> {
  const v = await getSetting(db, SETTING_KEYS.WEEKLY_SEND_TIME)
  return v ?? AUTO_DEFAULTS.WEEKLY_SEND_TIME
}

// 다음 VOL 번호를 반환하고 카운터를 증가시킨다 (원자성: 단일 호출 안에서만 안전)
// 일반적으로 weekly_summaries INSERT 직전에 호출
export async function consumeNextVolNo(db: D1Database): Promise<number> {
  const cur = await getSetting(db, SETTING_KEYS.WEEKLY_VOL_COUNTER)
  const curN = cur ? parseInt(cur, 10) || 0 : 0
  const next = curN + 1
  await setSetting(db, SETTING_KEYS.WEEKLY_VOL_COUNTER, String(next))
  return next
}

// 다음 VOL 번호를 미리보기 (증가 X)
export async function peekNextVolNo(db: D1Database): Promise<number> {
  const cur = await getSetting(db, SETTING_KEYS.WEEKLY_VOL_COUNTER)
  const curN = cur ? parseInt(cur, 10) || 0 : 0
  return curN + 1
}
