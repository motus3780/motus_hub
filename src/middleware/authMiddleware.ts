// 관리자 인증 미들웨어

import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { getSessionAdmin } from '../lib/auth'
import type { Bindings, AppVariables } from '../lib/types'

// API 요청 여부 판정: /api/* 또는 /admin/api/* 또는 Accept: application/json 헤더
function isApiRequest(c: any): boolean {
  const p = c.req.path
  if (p.startsWith('/api/') || p.startsWith('/admin/api/')) return true
  const accept = c.req.header('accept') || ''
  return accept.includes('application/json')
}

export const requireAdmin = createMiddleware<{ Bindings: Bindings; Variables: AppVariables }>(async (c, next) => {
  const token = getCookie(c, 'admin_session')
  if (!token) {
    if (isApiRequest(c)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    return c.redirect('/admin/login')
  }
  const admin = await getSessionAdmin(c.env.DB, token)
  if (!admin) {
    if (isApiRequest(c)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    return c.redirect('/admin/login')
  }
  c.set('adminId', admin.id)
  c.set('adminUsername', admin.username)
  await next()
})
