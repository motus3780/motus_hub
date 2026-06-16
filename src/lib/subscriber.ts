// 구독자 관리

import { generateToken, isValidEmail } from './utils'
import type { Subscriber } from './types'

export async function addSubscriber(db: D1Database, email: string, name?: string): Promise<{ id: number; token: string } | { error: string }> {
  if (!isValidEmail(email)) return { error: '올바른 이메일 형식이 아닙니다.' }
  const existing = await db.prepare('SELECT id, active, unsubscribe_token FROM subscribers WHERE email = ?')
    .bind(email).first<{ id: number; active: number; unsubscribe_token: string }>()
  if (existing) {
    if (existing.active === 1) return { error: '이미 구독중인 이메일입니다.' }
    // 재구독
    await db.prepare('UPDATE subscribers SET active = 1, unsubscribed_at = NULL, name = ? WHERE id = ?')
      .bind(name || null, existing.id).run()
    return { id: existing.id, token: existing.unsubscribe_token }
  }
  const token = generateToken(40)
  const r = await db.prepare(`
    INSERT INTO subscribers (email, name, active, unsubscribe_token) VALUES (?, ?, 1, ?)
  `).bind(email, name || null, token).run()
  return { id: r.meta.last_row_id as number, token }
}

export async function unsubscribeByToken(db: D1Database, token: string): Promise<boolean> {
  const r = await db.prepare(`
    UPDATE subscribers SET active = 0, unsubscribed_at = CURRENT_TIMESTAMP WHERE unsubscribe_token = ? AND active = 1
  `).bind(token).run()
  return r.meta.changes > 0
}

/**
 * 구독자 삭제 (이력 보존)
 *  - email_logs.subscriber_id 는 ON DELETE SET NULL 이므로 발송 이력은 유지된 채
 *    참조만 NULL 로 끊어진다 (마이그레이션 0004 적용 필요).
 *  - 환경에 따라 FK 가 SET NULL 로 변경되지 않은 경우를 대비해, 명시적으로
 *    email_logs 의 subscriber_id 를 먼저 NULL 처리한 뒤 subscribers 를 삭제한다.
 *  - 삭제된 행 수와 정리된 이력 수를 반환한다.
 */
export async function deleteSubscriber(
  db: D1Database,
  id: number
): Promise<{ deleted: boolean; subscriber: Subscriber | null; logsDetached: number }> {
  // 1) 대상 구독자 조회 (없으면 deleted=false)
  const sub = await db.prepare('SELECT * FROM subscribers WHERE id = ?')
    .bind(id).first<Subscriber>()
  if (!sub) {
    return { deleted: false, subscriber: null, logsDetached: 0 }
  }

  // 2) 발송 이력 보존: subscriber_id 만 NULL 로 끊기 (recipient/error_message 등은 유지)
  const detach = await db.prepare(
    'UPDATE email_logs SET subscriber_id = NULL WHERE subscriber_id = ?'
  ).bind(id).run().catch(() => ({ meta: { changes: 0 } }))
  const logsDetached = (detach.meta && (detach.meta as any).changes) || 0

  // 3) 구독자 삭제
  const r = await db.prepare('DELETE FROM subscribers WHERE id = ?').bind(id).run()
  const deleted = ((r.meta && (r.meta as any).changes) || 0) > 0
  return { deleted, subscriber: sub, logsDetached }
}

export async function listSubscribers(db: D1Database, opts: { active?: number; search?: string; limit?: number; offset?: number } = {}): Promise<Subscriber[]> {
  const where: string[] = []
  const binds: any[] = []
  if (opts.active !== undefined) { where.push('active = ?'); binds.push(opts.active) }
  if (opts.search) { where.push('(email LIKE ? OR name LIKE ?)'); binds.push(`%${opts.search}%`, `%${opts.search}%`) }
  let q = 'SELECT * FROM subscribers'
  if (where.length) q += ' WHERE ' + where.join(' AND ')
  q += ' ORDER BY id DESC'
  if (opts.limit) { q += ' LIMIT ?'; binds.push(opts.limit) }
  if (opts.offset) { q += ' OFFSET ?'; binds.push(opts.offset) }
  const r = await db.prepare(q).bind(...binds).all<Subscriber>()
  return r.results
}

export async function getActiveSubscribers(db: D1Database): Promise<Subscriber[]> {
  const r = await db.prepare('SELECT * FROM subscribers WHERE active = 1 ORDER BY id ASC').all<Subscriber>()
  return r.results
}

export async function countSubscribers(db: D1Database): Promise<{ total: number; active: number }> {
  const total = await db.prepare('SELECT COUNT(*) as c FROM subscribers').first<{ c: number }>()
  const active = await db.prepare('SELECT COUNT(*) as c FROM subscribers WHERE active = 1').first<{ c: number }>()
  return { total: total?.c ?? 0, active: active?.c ?? 0 }
}

// ─────────────────────────────────────────────────────────────────────────
// 수신자 프로필 (회사·키워드·관심구역) 업데이트
// 0009_subscriber_personalization 마이그레이션 후 사용 가능
// ─────────────────────────────────────────────────────────────────────────

export interface SubscriberProfileFields {
  company?: string | null
  company_profile?: string | null
  focus_keywords?: string[] | null
  competitor_keywords?: string[] | null
  watch_regions?: string[] | null
}

/** JSON 배열 또는 null로 인코딩 (DB 저장용) */
function toJsonOrNull(v: string[] | null | undefined): string | null {
  if (v == null) return null
  if (!Array.isArray(v)) return null
  return JSON.stringify(v.filter(s => typeof s === 'string'))
}

/**
 * 구독자의 프로필 필드 일괄 업데이트.
 * 전달된 필드만 갱신 (undefined인 필드는 SET절에서 제외).
 * null을 명시적으로 전달하면 NULL로 초기화.
 */
export async function updateSubscriberProfile(
  db: D1Database,
  id: number,
  fields: SubscriberProfileFields,
): Promise<boolean> {
  const sets: string[] = []
  const binds: any[] = []
  if (fields.company !== undefined) { sets.push('company = ?'); binds.push(fields.company) }
  if (fields.company_profile !== undefined) { sets.push('company_profile = ?'); binds.push(fields.company_profile) }
  if (fields.focus_keywords !== undefined) { sets.push('focus_keywords = ?'); binds.push(toJsonOrNull(fields.focus_keywords)) }
  if (fields.competitor_keywords !== undefined) { sets.push('competitor_keywords = ?'); binds.push(toJsonOrNull(fields.competitor_keywords)) }
  if (fields.watch_regions !== undefined) { sets.push('watch_regions = ?'); binds.push(toJsonOrNull(fields.watch_regions)) }
  if (sets.length === 0) return false
  binds.push(id)
  const r = await db.prepare(`UPDATE subscribers SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run()
  return ((r.meta && (r.meta as any).changes) || 0) > 0
}

/** 구독자 단건 조회 (프로필 컬럼 포함) */
export async function getSubscriberById(
  db: D1Database,
  id: number,
): Promise<any | null> {
  return await db.prepare('SELECT * FROM subscribers WHERE id = ?').bind(id).first<any>()
}

/** company_profile별 활성 구독자 그룹 */
export async function listSubscribersByCompanyProfile(
  db: D1Database,
  companyProfile: string,
): Promise<any[]> {
  const r = await db.prepare(
    'SELECT * FROM subscribers WHERE active = 1 AND company_profile = ? ORDER BY id ASC'
  ).bind(companyProfile).all<any>()
  return r.results
}

/**
 * 회사 프로필별 활성 구독자 통계 (대시보드용)
 * - 회사가 지정되지 않은 활성 구독자도 '_general' 키로 집계
 */
export async function getCompanyProfileStats(
  db: D1Database,
): Promise<Array<{ company_profile: string; company: string | null; count: number }>> {
  const r = await db.prepare(`
    SELECT
      COALESCE(company_profile, '_general') AS company_profile,
      MAX(company) AS company,
      COUNT(*) AS count
    FROM subscribers
    WHERE active = 1
    GROUP BY COALESCE(company_profile, '_general')
    ORDER BY count DESC
  `).all<{ company_profile: string; company: string | null; count: number }>()
  return r.results
}

// ─────────────────────────────────────────────────────────────────────────
// CSV 일괄 등록 (회사별 구독자 다수 등록 환경 구축)
// 입력 CSV 형식 (헤더 필수):
//   email,name,company,company_profile
//   weekly1@gsenc.com,홍길동,GS건설,gs
//   weekly2@gsenc.com,,GS건설,gs
//   weekly3@hdec.co.kr,김철수,현대건설,hyundai
//
// 동작:
//   - email 중복 → 기존 row 갱신 (active=1, name/company/company_profile 덮어쓰기)
//   - email 누락/유효 X → 해당 줄 skip + errors 에 기록
//   - focus_keywords/competitor_keywords/watch_regions 는 CSV에 포함하지 않음
//     (수신자 단위 커스텀이 필요한 경우 별도 PUT /subscribers/:id/profile 사용)
// ─────────────────────────────────────────────────────────────────────────

export interface BulkImportRow {
  email: string
  name?: string | null
  company?: string | null
  company_profile?: string | null
}

export interface BulkImportResult {
  total: number
  created: number
  updated: number
  skipped: number
  errors: Array<{ line: number; email?: string; reason: string }>
}

/** CSV 한 줄 파싱 (단순 콤마 분리, 쌍따옴표 escape 지원) */
function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ }
        else { inQuote = false }
      } else {
        cur += ch
      }
    } else {
      if (ch === ',') { cells.push(cur); cur = '' }
      else if (ch === '"' && cur.length === 0) { inQuote = true }
      else { cur += ch }
    }
  }
  cells.push(cur)
  return cells.map(s => s.trim())
}

/**
 * CSV 텍스트를 파싱하여 구조화된 행 배열 반환
 * - 첫 줄은 헤더로 간주
 * - 필수 컬럼: email
 * - 선택 컬럼: name, company, company_profile
 */
export function parseSubscribersCsv(
  csvText: string,
): { rows: BulkImportRow[]; errors: Array<{ line: number; reason: string }> } {
  const lines = csvText.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim().length > 0)
  if (lines.length === 0) return { rows: [], errors: [{ line: 0, reason: 'CSV 본문이 비어있음' }] }

  const header = parseCsvLine(lines[0]).map(h => h.toLowerCase())
  const idxEmail = header.indexOf('email')
  if (idxEmail < 0) {
    return { rows: [], errors: [{ line: 1, reason: "헤더에 'email' 컬럼 필요" }] }
  }
  const idxName = header.indexOf('name')
  const idxCompany = header.indexOf('company')
  const idxProfile = header.indexOf('company_profile')

  const rows: BulkImportRow[] = []
  const errors: Array<{ line: number; reason: string }> = []

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i])
    const email = (cells[idxEmail] || '').trim().toLowerCase()
    if (!email) {
      errors.push({ line: i + 1, reason: 'email 비어있음' })
      continue
    }
    rows.push({
      email,
      name: idxName >= 0 ? (cells[idxName] || null) : null,
      company: idxCompany >= 0 ? (cells[idxCompany] || null) : null,
      company_profile: idxProfile >= 0 ? (cells[idxProfile] || null) : null,
    })
  }
  return { rows, errors }
}

/**
 * CSV 일괄 등록 실행 (UPSERT 패턴)
 * - 신규 email → INSERT (active=1, unsubscribe_token 발급)
 * - 기존 email → UPDATE (active=1 복귀, name/company/company_profile 덮어쓰기)
 */
export async function bulkUpsertSubscribers(
  db: D1Database,
  rows: BulkImportRow[],
  preErrors: Array<{ line: number; reason: string }> = [],
): Promise<BulkImportResult> {
  const result: BulkImportResult = {
    total: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: preErrors.map(e => ({ ...e })),
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const email = (r.email || '').trim().toLowerCase()

    if (!isValidEmail(email)) {
      result.skipped++
      result.errors.push({ line: i + 2, email, reason: '유효하지 않은 이메일' })
      continue
    }

    try {
      const existing = await db.prepare(
        'SELECT id, active, unsubscribe_token FROM subscribers WHERE email = ?'
      ).bind(email).first<{ id: number; active: number; unsubscribe_token: string }>()

      if (existing) {
        await db.prepare(`
          UPDATE subscribers
          SET active = 1,
              unsubscribed_at = NULL,
              name = COALESCE(?, name),
              company = COALESCE(?, company),
              company_profile = COALESCE(?, company_profile)
          WHERE id = ?
        `).bind(r.name || null, r.company || null, r.company_profile || null, existing.id).run()
        result.updated++
      } else {
        const token = generateToken(40)
        await db.prepare(`
          INSERT INTO subscribers
            (email, name, active, unsubscribe_token, company, company_profile)
          VALUES (?, ?, 1, ?, ?, ?)
        `).bind(email, r.name || null, token, r.company || null, r.company_profile || null).run()
        result.created++
      }
    } catch (e: any) {
      result.skipped++
      result.errors.push({ line: i + 2, email, reason: `DB 오류: ${e?.message || String(e)}` })
    }
  }
  return result
}
