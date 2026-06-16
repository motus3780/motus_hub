// 관리자 인증 (세션 기반)

import { sha256, generateToken } from './utils'

export async function createAdmin(db: D1Database, username: string, password: string): Promise<number> {
  const hash = await sha256(password)
  const result = await db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)')
    .bind(username, hash).run()
  return result.meta.last_row_id as number
}

export async function updateAdminPassword(db: D1Database, adminId: number, password: string): Promise<void> {
  const hash = await sha256(password)
  await db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').bind(hash, adminId).run()
}

export async function verifyAdmin(db: D1Database, username: string, password: string): Promise<{ id: number; username: string } | null> {
  const hash = await sha256(password)
  const row = await db.prepare('SELECT id, username FROM admins WHERE username = ? AND password_hash = ?')
    .bind(username, hash).first<{ id: number; username: string }>()
  return row ?? null
}

export async function getFirstAdmin(db: D1Database): Promise<{ id: number; username: string } | null> {
  return await db.prepare('SELECT id, username FROM admins ORDER BY id ASC LIMIT 1').first<{ id: number; username: string }>()
}

// 세션
const SESSION_DURATION_HOURS = 24 * 7 // 7일

export async function createSession(db: D1Database, adminId: number): Promise<string> {
  const token = generateToken(48)
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 3600 * 1000).toISOString()
  await db.prepare('INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, adminId, expiresAt).run()
  return token
}

export async function getSessionAdmin(db: D1Database, token: string): Promise<{ id: number; username: string } | null> {
  if (!token) return null
  const row = await db.prepare(`
    SELECT a.id, a.username
    FROM admin_sessions s
    JOIN admins a ON s.admin_id = a.id
    WHERE s.token = ? AND s.expires_at > CURRENT_TIMESTAMP
  `).bind(token).first<{ id: number; username: string }>()
  return row ?? null
}

export async function destroySession(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run()
}

export async function cleanExpiredSessions(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions WHERE expires_at <= CURRENT_TIMESTAMP').run()
}
