// 자사 콘텐츠 (모투스 소식) 관리

import type { CompanyContent } from './types'
import { todayKST } from './utils'

export async function listContents(
  db: D1Database,
  opts: { status?: string; category?: string; search?: string; limit?: number; offset?: number } = {}
): Promise<CompanyContent[]> {
  const where: string[] = []
  const binds: any[] = []
  if (opts.status) { where.push('status = ?'); binds.push(opts.status) }
  if (opts.category) { where.push('category = ?'); binds.push(opts.category) }
  if (opts.search) { where.push('(title LIKE ? OR body LIKE ?)'); binds.push(`%${opts.search}%`, `%${opts.search}%`) }
  let q = 'SELECT * FROM company_contents'
  if (where.length) q += ' WHERE ' + where.join(' AND ')
  q += ' ORDER BY is_pinned DESC, updated_at DESC'
  if (opts.limit) { q += ' LIMIT ?'; binds.push(opts.limit) }
  if (opts.offset) { q += ' OFFSET ?'; binds.push(opts.offset) }
  const r = await db.prepare(q).bind(...binds).all<CompanyContent>()
  return r.results
}

export async function getContent(db: D1Database, id: number): Promise<CompanyContent | null> {
  return await db.prepare('SELECT * FROM company_contents WHERE id = ?').bind(id).first<CompanyContent>()
}

export interface ContentInput {
  title: string
  body: string
  category: string
  image_url?: string | null
  external_link?: string | null
  start_date?: string | null
  end_date?: string | null
  show_in_email?: number
  is_pinned?: number
  status?: string
}

export async function createContent(db: D1Database, c: ContentInput): Promise<number> {
  const r = await db.prepare(`
    INSERT INTO company_contents (title, body, category, image_url, external_link, start_date, end_date, show_in_email, is_pinned, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    c.title,
    c.body,
    c.category,
    c.image_url || null,
    c.external_link || null,
    c.start_date || null,
    c.end_date || null,
    c.show_in_email ?? 1,
    c.is_pinned ?? 0,
    c.status || 'draft'
  ).run()
  return r.meta.last_row_id as number
}

export async function updateContent(db: D1Database, id: number, c: Partial<ContentInput>): Promise<void> {
  const sets: string[] = []
  const binds: any[] = []
  for (const [k, v] of Object.entries(c)) {
    sets.push(`${k} = ?`)
    binds.push(v)
  }
  sets.push('updated_at = CURRENT_TIMESTAMP')
  binds.push(id)
  await db.prepare(`UPDATE company_contents SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run()
}

export async function deleteContent(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM company_contents WHERE id = ?').bind(id).run()
}

export async function duplicateContent(db: D1Database, id: number): Promise<number | null> {
  const orig = await getContent(db, id)
  if (!orig) return null
  return await createContent(db, {
    title: orig.title + ' (복사)',
    body: orig.body,
    category: orig.category,
    image_url: orig.image_url,
    external_link: orig.external_link,
    start_date: orig.start_date,
    end_date: orig.end_date,
    show_in_email: orig.show_in_email,
    is_pinned: 0,
    status: 'draft'
  })
}

// 노출 가능한 콘텐츠 (현재 노출 기간이고 status=published)
export async function getActiveContents(db: D1Database, opts: { emailOnly?: boolean; limit?: number } = {}): Promise<CompanyContent[]> {
  const today = todayKST()
  const where: string[] = ["status = 'published'"]
  where.push("(start_date IS NULL OR start_date <= ?)")
  where.push("(end_date IS NULL OR end_date >= ?)")
  const binds: any[] = [today, today]
  if (opts.emailOnly) where.push('show_in_email = 1')
  let q = `SELECT * FROM company_contents WHERE ${where.join(' AND ')} ORDER BY is_pinned DESC, updated_at DESC`
  if (opts.limit) { q += ' LIMIT ?'; binds.push(opts.limit) }
  const r = await db.prepare(q).bind(...binds).all<CompanyContent>()
  return r.results
}

export async function incrementView(db: D1Database, id: number): Promise<void> {
  await db.prepare('UPDATE company_contents SET view_count = view_count + 1 WHERE id = ?').bind(id).run()
}

export async function recordClick(db: D1Database, id: number, source: 'email' | 'web'): Promise<void> {
  await db.prepare('UPDATE company_contents SET click_count = click_count + 1 WHERE id = ?').bind(id).run()
  await db.prepare('INSERT INTO content_clicks (content_id, source) VALUES (?, ?)').bind(id, source).run()
}
