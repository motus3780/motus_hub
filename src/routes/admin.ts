// 관리자 API 라우트 (인증 필요)

import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import type { Bindings, AppVariables } from '../lib/types'
import { requireAdmin } from '../middleware/authMiddleware'
import { verifyAdmin, createSession, destroySession, getFirstAdmin, createAdmin, updateAdminPassword } from '../lib/auth'
import {
  listContents, getContent, createContent, updateContent, deleteContent, duplicateContent
} from '../lib/content'
import {
  listSubscribers, deleteSubscriber, addSubscriber, countSubscribers,
  updateSubscriberProfile, getSubscriberById, listSubscribersByCompanyProfile,
  getCompanyProfileStats, parseSubscribersCsv, bulkUpsertSubscribers,
} from '../lib/subscriber'
import { COMPANY_PROFILES, getCompanyProfile, profileFromSubscriberRow, verifyCompanySummary } from '../lib/companyProfiles'
import {
  generateWeeklySummary, savePersonalizedWeeklySummary, getPersonalizedWeeklySummary,
  extractMarketOneliner, listPersonalizedWeeklySummariesByWeek,
  setOperatorReview, listPendingOperatorReviews,
} from '../lib/ai'
import { runPersonalizedWeeklyJob, runAllPersonalizedWeeklyJobs, runWeeklyJob } from '../lib/weeklyJob'
import { getAllSettings, setSettings, isSetupComplete, SETTING_KEYS } from '../lib/settings'
import { runDailyJob } from '../lib/dailyJob'
import { sendEmail, logEmailSend } from '../lib/email'
import { todayKST } from '../lib/utils'
import { getSetting } from '../lib/settings'
import { searchNews, getAvailableSources, getEnabledCategoryGroups, setEnabledCategoryGroups } from '../lib/news'
import { loadCustomMappings, saveMediaMappings, DEFAULT_MEDIA_MAPPINGS } from '../lib/media'
import {
  loadAutoJobConfig, validateAutoTimes, getNextRunKST,
  getLastAutoJobLog, getAutoJobLogs, hasCompletedToday,
  runAutoCollect, runAutoSend
} from '../lib/autoJob'
import {
  listSendJobs, getSendJob, getEmailSendLogsByJob, getFailedRecipients,
  makeJobId
} from '../lib/sendJob'
import {
  listWeeklyEvents, getWeeklyEvent, createWeeklyEvent,
  updateWeeklyEvent, deleteWeeklyEvent, countWeeklyEventsByWeek,
  type WeeklyEventInput,
} from '../lib/weeklyEvents'
import { getLastWeekRange, getWeekStartOf } from '../lib/utils'
import {
  MANAGEABLE_SECTION_KEYS, SECTION_KEY_META,
  listSectionImages, upsertSectionImage, deleteSectionImage,
  listWeeklyTopImages, upsertWeeklyTopImage, deleteWeeklyTopImage,
  getSectionImageMap, tryDeleteR2Object,
} from '../lib/weeklyImages'
import { renderWeeklyEmail, renderDailyEmail, makeWeeklySubject } from '../templates/email'
import { getNewsByDate, pickBalancedTopNews } from '../lib/news'
import { getSummaryByDate } from '../lib/ai'
import {
  formatWeekRangeKo, formatIssueLabelKo,
} from '../lib/utils'

const admin = new Hono<{ Bindings: Bindings; Variables: AppVariables }>()

// === 전역 에러 핸들러 (구조화된 JSON 에러 응답) ===
// - 운영 환경(CF_PAGES=1): 사용자에게는 친화적 메시지, 상세는 details에 짧게
// - 개발/관리자 페이지: error / code / details / stack 모두 반환하여 디버깅 가능
admin.onError((err, c) => {
  const msg = (err as any)?.message || String(err)
  const stack = (err as any)?.stack || ''
  const cause = (err as any)?.cause
  console.error('[admin.onError]', {
    path: c.req.path,
    method: c.req.method,
    msg,
    stack,
    cause: cause ? String(cause) : undefined,
  })

  // 식별 가능한 오류 분류
  let code = 'INTERNAL_ERROR'
  let userError = '서버 내부 오류가 발생했습니다.'
  let httpStatus = 500
  if (/FOREIGN KEY/i.test(msg) || /SQLITE_CONSTRAINT_FOREIGNKEY/i.test(msg)) {
    code = 'FK_CONSTRAINT'
    userError = '연관 데이터로 인해 작업을 완료할 수 없습니다.'
  } else if (/UNIQUE/i.test(msg) || /SQLITE_CONSTRAINT_UNIQUE/i.test(msg)) {
    code = 'UNIQUE_CONSTRAINT'
    userError = '이미 존재하는 값입니다.'
    httpStatus = 409
  } else if (/NOT NULL/i.test(msg) || /SQLITE_CONSTRAINT_NOTNULL/i.test(msg)) {
    code = 'NOT_NULL_CONSTRAINT'
    userError = '필수 항목이 누락되었습니다.'
    httpStatus = 400
  }

  // CF_PAGES 환경변수가 '1'이면 운영 빌드(Cloudflare Pages 런타임)
  const isProd = (c.env as any)?.CF_PAGES === '1' || (c.env as any)?.CF_PAGES === 1
  const body: Record<string, any> = {
    success: false,
    error: userError,
    code,
    details: msg,  // 관리자 페이지에서 활용할 상세 메시지
  }
  if (!isProd) {
    body.stack = stack
    if (cause) body.cause = String(cause)
  }
  return c.json(body, httpStatus as any)
})

// === 셋업 ===
admin.get('/setup-status', async (c) => {
  const completed = await isSetupComplete(c.env.DB)
  const adminExists = !!(await getFirstAdmin(c.env.DB))
  return c.json({ completed, adminExists })
})

admin.post('/setup', async (c) => {
  const body = await c.req.json<any>().catch(() => ({}))
  const completed = await isSetupComplete(c.env.DB)
  if (completed) {
    return c.json({ error: '이미 셋업이 완료되었습니다. 환경설정에서 변경하세요.' }, 400)
  }
  const required = ['username', 'password']
  for (const k of required) {
    if (!body[k]) return c.json({ error: `${k}는 필수입니다.` }, 400)
  }
  // 관리자 계정 생성
  const existing = await getFirstAdmin(c.env.DB)
  if (existing) {
    return c.json({ error: '관리자 계정이 이미 존재합니다.' }, 400)
  }
  await createAdmin(c.env.DB, body.username, body.password)

  // 설정 저장
  const kv: Record<string, string> = {}
  if (body.naver_client_id) kv[SETTING_KEYS.NAVER_CLIENT_ID] = body.naver_client_id
  if (body.naver_client_secret) kv[SETTING_KEYS.NAVER_CLIENT_SECRET] = body.naver_client_secret
  if (body.claude_api_key) kv[SETTING_KEYS.CLAUDE_API_KEY] = body.claude_api_key
  if (body.claude_model) kv[SETTING_KEYS.CLAUDE_MODEL] = body.claude_model
  if (body.resend_api_key) kv[SETTING_KEYS.RESEND_API_KEY] = body.resend_api_key
  if (body.sender_name) kv[SETTING_KEYS.SENDER_NAME] = body.sender_name
  if (body.sender_email) kv[SETTING_KEYS.SENDER_EMAIL] = body.sender_email
  if (body.company_logo_url) kv[SETTING_KEYS.COMPANY_LOGO_URL] = body.company_logo_url
  if (body.site_url) kv[SETTING_KEYS.SITE_URL] = body.site_url
  if (body.send_hour_kst) kv[SETTING_KEYS.SEND_HOUR_KST] = String(body.send_hour_kst)
  kv[SETTING_KEYS.SETUP_COMPLETED] = '1'
  await setSettings(c.env.DB, kv)
  return c.json({ success: true })
})

// === 인증 ===
admin.post('/login', async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>().catch(() => ({}))
  if (!body.username || !body.password) return c.json({ error: 'ID/PW를 입력하세요.' }, 400)
  const a = await verifyAdmin(c.env.DB, body.username, body.password)
  if (!a) return c.json({ error: 'ID 또는 비밀번호가 올바르지 않습니다.' }, 401)
  const token = await createSession(c.env.DB, a.id)
  setCookie(c, 'admin_session', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 7
  })
  return c.json({ success: true, username: a.username })
})

admin.post('/logout', async (c) => {
  const { getCookie } = await import('hono/cookie')
  const token = getCookie(c, 'admin_session')
  if (token) await destroySession(c.env.DB, token)
  deleteCookie(c, 'admin_session', { path: '/' })
  return c.json({ success: true })
})

// === 이하 인증 필요 ===
admin.use('/*', requireAdmin)

admin.get('/me', async (c) => {
  return c.json({ id: c.get('adminId'), username: c.get('adminUsername') })
})

admin.post('/change-password', async (c) => {
  const body = await c.req.json<{ password?: string }>().catch(() => ({}))
  if (!body.password || body.password.length < 4) return c.json({ error: '비밀번호는 4자 이상' }, 400)
  await updateAdminPassword(c.env.DB, c.get('adminId')!, body.password)
  return c.json({ success: true })
})

// === 자사 콘텐츠 ===
admin.get('/contents', async (c) => {
  const status = c.req.query('status') || undefined
  const category = c.req.query('category') || undefined
  const search = c.req.query('search') || undefined
  const items = await listContents(c.env.DB, { status, category, search })
  return c.json({ items })
})

admin.get('/contents/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const item = await getContent(c.env.DB, id)
  if (!item) return c.json({ error: 'Not found' }, 404)
  return c.json({ item })
})

admin.post('/contents', async (c) => {
  const body = await c.req.json<any>().catch(() => ({}))
  if (!body.title || !body.body || !body.category) {
    return c.json({ error: '제목/본문/카테고리는 필수입니다.' }, 400)
  }
  const id = await createContent(c.env.DB, body)
  return c.json({ success: true, id })
})

admin.put('/contents/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json<any>().catch(() => ({}))
  await updateContent(c.env.DB, id, body)
  return c.json({ success: true })
})

admin.delete('/contents/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  await deleteContent(c.env.DB, id)
  return c.json({ success: true })
})

admin.post('/contents/:id/duplicate', async (c) => {
  const id = parseInt(c.req.param('id'))
  const newId = await duplicateContent(c.env.DB, id)
  return c.json({ success: true, id: newId })
})

// 이미지 업로드 (R2)
admin.post('/upload', async (c) => {
  if (!c.env.R2) {
    return c.json({ error: 'R2 스토리지가 연결되어 있지 않습니다. Cloudflare 대시보드에서 R2 binding을 추가해 주세요.' }, 503)
  }
  const formData = await c.req.formData()
  const file = formData.get('file') as File
  if (!file) return c.json({ error: '파일이 없습니다.' }, 400)
  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const key = `uploads/${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${ext}`
  const arrayBuffer = await file.arrayBuffer()
  await c.env.R2.put(key, arrayBuffer, {
    httpMetadata: { contentType: file.type || 'application/octet-stream' }
  })
  return c.json({ success: true, url: `/r2/${key}`, key })
})

// === 구독자 관리 ===
admin.get('/subscribers', async (c) => {
  const search = c.req.query('search') || undefined
  const activeQ = c.req.query('active')
  const active = activeQ === undefined ? undefined : parseInt(activeQ)
  const items = await listSubscribers(c.env.DB, { search, active })
  const counts = await countSubscribers(c.env.DB)
  return c.json({ items, counts })
})

admin.post('/subscribers', async (c) => {
  const body = await c.req.json<{ email?: string; name?: string }>().catch(() => ({}))
  if (!body.email) return c.json({ error: '이메일은 필수' }, 400)
  const r = await addSubscriber(c.env.DB, body.email.trim().toLowerCase(), body.name?.trim())
  if ('error' in r) return c.json({ error: r.error }, 400)
  return c.json({ success: true, id: r.id })
})

admin.delete('/subscribers/:id', async (c) => {
  const idRaw = c.req.param('id')
  const id = parseInt(idRaw)
  if (!id || isNaN(id) || id <= 0) {
    return c.json({
      success: false,
      error: '올바르지 않은 구독자 ID 입니다.',
      code: 'INVALID_ID',
      details: `id=${idRaw}`
    }, 400)
  }
  try {
    const r = await deleteSubscriber(c.env.DB, id)
    if (!r.deleted) {
      return c.json({
        success: false,
        error: '구독자를 찾을 수 없습니다.',
        code: 'NOT_FOUND',
        details: `id=${id}`
      }, 404)
    }
    return c.json({
      success: true,
      message: `${r.subscriber?.name || r.subscriber?.email || '구독자'}님이 삭제되었습니다.`,
      subscriber: {
        id: r.subscriber?.id,
        email: r.subscriber?.email,
        name: r.subscriber?.name
      },
      logsDetached: r.logsDetached
    })
  } catch (e: any) {
    const msg = e?.message || String(e)
    const stack = e?.stack || ''
    console.error('[DELETE /admin/api/subscribers/:id] failed', { id, msg, stack })
    // FK 제약 위반 등 식별 가능한 오류 코드 분류
    let code = 'DELETE_FAILED'
    let userError = '구독자 삭제 중 오류가 발생했습니다.'
    if (/FOREIGN KEY/i.test(msg) || /SQLITE_CONSTRAINT_FOREIGNKEY/i.test(msg)) {
      code = 'FK_CONSTRAINT'
      userError = '연관된 발송 이력으로 인해 삭제할 수 없습니다. 관리자에게 문의하세요.'
    }
    return c.json({
      success: false,
      error: userError,
      code,
      details: msg,
      stack: c.env.CF_PAGES ? undefined : stack  // 운영(CF_PAGES=1)에서는 스택 숨김
    }, 500)
  }
})

admin.get('/subscribers.csv', async (c) => {
  const items = await listSubscribers(c.env.DB, {})
  let csv = 'id,email,name,active,created_at\n'
  for (const s of items) {
    csv += `${s.id},"${s.email}","${(s.name || '').replace(/"/g, '""')}",${s.active},${s.created_at}\n`
  }
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="subscribers-${todayKST()}.csv"`
    }
  })
})

// === 발송 이력 / 대시보드 ===
admin.get('/dashboard', async (c) => {
  const counts = await countSubscribers(c.env.DB)
  const today = todayKST()

  // 오늘 발송
  const todayLogs = await c.env.DB.prepare(`
    SELECT status, COUNT(*) as cnt FROM email_logs WHERE send_date = ? GROUP BY status
  `).bind(today).all<{ status: string; cnt: number }>()
  const todaySend = { success: 0, failed: 0 }
  for (const r of todayLogs.results) {
    if (r.status === 'success') todaySend.success = r.cnt
    if (r.status === 'failed') todaySend.failed = r.cnt
  }

  // 최근 7일 발송 추이
  const trend = await c.env.DB.prepare(`
    SELECT send_date, status, COUNT(*) as cnt
    FROM email_logs
    WHERE send_date >= date('now', '-7 days')
    GROUP BY send_date, status
    ORDER BY send_date ASC
  `).all<{ send_date: string; status: string; cnt: number }>()

  // 자사 콘텐츠 통계
  const contentStats = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(view_count),0) as views, COALESCE(SUM(click_count),0) as clicks, COUNT(*) as total
    FROM company_contents WHERE status = 'published'
  `).first<{ views: number; clicks: number; total: number }>()

  return c.json({
    subscribers: counts,
    todaySend,
    trend: trend.results,
    contentStats: contentStats || { views: 0, clicks: 0, total: 0 }
  })
})

admin.get('/email-logs', async (c) => {
  const date = c.req.query('date')
  const limit = parseInt(c.req.query('limit') || '100')
  let q = `
    SELECT el.*, s.name as subscriber_name
    FROM email_logs el
    LEFT JOIN subscribers s ON el.subscriber_id = s.id
  `
  const binds: any[] = []
  if (date) { q += ' WHERE el.send_date = ?'; binds.push(date) }
  q += ' ORDER BY el.created_at DESC LIMIT ?'
  binds.push(limit)
  const r = await c.env.DB.prepare(q).bind(...binds).all()
  return c.json({ items: r.results })
})

// === 즉시 발송 / 수동 수집 ===
// body.force=true 이면 오늘자 작업이 이미 'completed' 상태여도 멱등성을 우회하여 전원 재발송
// B-1: skipCollect=true 강제 → 저장된 오늘자 요약 재사용, 수집·AI 요약 재실행 안 함
// B-2: waitUntil로 백그라운드 처리 → 즉시 { ok, started } 응답, 진행은 /send-progress 폴링
admin.post('/run-daily', async (c) => {
  const body = await c.req.json<{ skipCollect?: boolean; skipSend?: boolean; force?: boolean }>().catch(() => ({}))
  if (body.force) {
    console.log(`[/run-daily] ⚡ 운영자 force 재발송 요청 수신`)
  }
  c.executionCtx.waitUntil(
    runDailyJob(c.env.DB, { ...body, skipCollect: true }, { RESEND_API_KEY: c.env.RESEND_API_KEY })
      .catch((e: any) => console.error('[/run-daily] 백그라운드 예외:', e?.message || e))
  )
  return c.json({ ok: true, started: true })
})

// B-4: 위클리 즉시 발송 — skipGenerate=true로 저장된 요약 재사용, 백그라운드 실행
admin.post('/run-weekly', async (c) => {
  const body = await c.req.json<{ force?: boolean }>().catch(() => ({}))
  if (body.force) {
    console.log(`[/run-weekly] ⚡ 운영자 force 재발송 요청 수신`)
  }
  c.executionCtx.waitUntil(
    runWeeklyJob(c.env.DB, { skipGenerate: true, trigger: 'manual', force: !!body.force }, { RESEND_API_KEY: c.env.RESEND_API_KEY })
      .catch((e: any) => console.error('[/run-weekly] 백그라운드 예외:', e?.message || e))
  )
  return c.json({ ok: true, started: true })
})

admin.post('/collect-now', async (c) => {
  const result = await runDailyJob(c.env.DB, { skipSend: true })
  return c.json(result)
})

// 발송 진행 상황 조회 (폴링용)
admin.get('/send-progress', async (c) => {
  const raw = await getSetting(c.env.DB, 'send_progress')
  if (!raw) {
    return c.json({ progress: null })
  }
  try {
    const progress = JSON.parse(raw)
    return c.json({ progress })
  } catch {
    return c.json({ progress: null })
  }
})

// === 테스트 발송 (관리자 본인 이메일로 1통) ===
admin.post('/test-send', async (c) => {
  const body = await c.req.json<{ to?: string }>().catch(() => ({}))
  const to = (body.to || '').trim().toLowerCase()
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return c.json({ success: false, error: '올바른 이메일 주소를 입력하세요.' }, 400)
  }

  const date = todayKST()
  const subject = `[테스트] 모투스 위클리 ${date}`
  const html = `
    <!DOCTYPE html>
    <html lang="ko"><head><meta charset="UTF-8"></head>
    <body style="font-family:'Pretendard','Apple SD Gothic Neo',sans-serif;background:#f4f6f8;padding:24px;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
        <div style="background:linear-gradient(135deg,#2c3e50 0%,#3498db 100%);color:#fff;padding:24px;border-radius:10px;margin-bottom:20px;">
          <div style="font-size:13px;opacity:0.85;letter-spacing:1px;">MOTUS COMPANY</div>
          <div style="font-size:22px;font-weight:800;margin-top:6px;">✅ 테스트 발송 성공</div>
        </div>
        <p style="font-size:15px;line-height:1.7;color:#34495e;">
          이 메일이 정상적으로 도착했다면, Resend 발송 설정이 올바르게 작동하고 있는 것입니다.
        </p>
        <ul style="font-size:14px;color:#5a6878;line-height:1.8;background:#f8fafc;padding:16px 22px;border-radius:8px;">
          <li>발송 일자: ${date}</li>
          <li>발송 방식: <strong>Resend</strong></li>
          <li>수신자: ${to}</li>
        </ul>
        <p style="font-size:13px;color:#95a5a6;margin-top:20px;">
          이 메일은 관리자 콘솔의 "테스트 발송" 기능으로 발송되었습니다.<br>
          실제 일일 뉴스레터에는 영향을 주지 않습니다.
        </p>
      </div>
    </body></html>`

  try {
    const r = await sendEmail(c.env.DB, { to, subject, html }, { RESEND_API_KEY: c.env.RESEND_API_KEY })
    await logEmailSend(c.env.DB, null, to, date, 'success', `[TEST] resend_id=${r.id || ''}`)
    return c.json({ success: true, id: r.id, raw: r.raw })
  } catch (e: any) {
    const errMsg = e?.message || String(e)
    await logEmailSend(c.env.DB, null, to, date, 'failed', `[TEST] ${errMsg}`)
    // Resend의 응답 본문(에러 메시지)을 그대로 화면에 노출
    return c.json({ success: false, error: errMsg }, 200)
  }
})

// ════════════════════════════════════════════════════════════════════
// 실제 템플릿 테스트 메일 (이미지 적용 확인용)
// — 운영자가 위클리 이미지 관리 페이지에서 이미지 등록 후 결과를 미리 받아볼 수 있음
// ════════════════════════════════════════════════════════════════════

/**
 * POST /admin/api/test-send-daily
 * Body: { to: string, date?: string }
 * — 실제 데일리 메일 템플릿 + 운영자 업로드 카테고리 대표 이미지로 1통 발송
 * — 멱등성 차단/스케줄 영향 없음 (test-send 계열은 send_jobs/email_send_log 미사용)
 */
admin.post('/test-send-daily', async (c) => {
  const body = await c.req.json<{ to?: string; date?: string }>().catch(() => ({}))
  const to = (body.to || '').trim().toLowerCase()
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return c.json({ success: false, error: '올바른 이메일 주소를 입력하세요.' }, 400)
  }
  const date = (body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) ? body.date : todayKST()

  try {
    // 1) 해당 날짜의 뉴스 + 요약 가져오기 (없으면 빈 데이터로 진행)
    const news = await getNewsByDate(c.env.DB, date).catch(() => [])
    const topNews = pickBalancedTopNews(news as any, 15)
    const summary = await getSummaryByDate(c.env.DB, date).catch(() => null)
    const summaryMarkdown = (summary as any)?.content
      || '## ✍️ 오늘의 한 줄 요약\n(테스트 메일이므로 요약이 비어있을 수 있습니다.)\n'

    // 2) 카테고리별 카운트
    const newsCounts: Record<string, number> = {}
    for (const n of news as any[]) {
      const cat = n.category || '기타'
      newsCounts[cat] = (newsCounts[cat] || 0) + 1
    }

    // 3) 설정 + 운영자 업로드 이미지
    const settingsMap = await getAllSettings(c.env.DB)
    const siteUrl = settingsMap[SETTING_KEYS.SITE_URL] || new URL(c.req.url).origin
    const logoUrl = settingsMap[SETTING_KEYS.COMPANY_LOGO_URL] || null
    const senderName = settingsMap[SETTING_KEYS.SENDER_NAME] || '모투스 위클리'
    const sectionImages = await getSectionImageMap(c.env.DB)

    // 4) 데일리 메일 HTML 렌더링 (실제 발송과 동일)
    const html = renderDailyEmail({
      date,
      summaryMarkdown,
      totalArticles: (news as any[]).length,
      newsCounts,
      topNews: topNews as any,
      companyContents: [],
      siteUrl,
      unsubscribeToken: 'test-preview',
      logoUrl,
      senderName,
      sectionImages,
    })

    // 5) 발송
    const subject = `[테스트·데일리] 모투스 위클리 ${date}`
    const r = await sendEmail(c.env.DB, { to, subject, html }, { RESEND_API_KEY: c.env.RESEND_API_KEY })
    await logEmailSend(c.env.DB, null, to, date, 'success', `[TEST-DAILY] resend_id=${r.id || ''}`)

    return c.json({
      success: true,
      id: r.id,
      to,
      date,
      sectionImagesApplied: Object.keys(sectionImages).length,
      newsCount: (news as any[]).length,
    })
  } catch (e: any) {
    const errMsg = e?.message || String(e)
    await logEmailSend(c.env.DB, null, to, date, 'failed', `[TEST-DAILY] ${errMsg}`).catch(() => {})
    return c.json({ success: false, error: errMsg }, 200)
  }
})

/**
 * POST /admin/api/test-send-weekly
 * Body: { to: string, week_start_date?: string }
 * — 실제 위클리 메일 템플릿 + 운영자 업로드 카테고리/TOP 이미지로 1통 발송
 */
admin.post('/test-send-weekly', async (c) => {
  const body = await c.req.json<{ to?: string; week_start_date?: string }>().catch(() => ({}))
  const to = (body.to || '').trim().toLowerCase()
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return c.json({ success: false, error: '올바른 이메일 주소를 입력하세요.' }, 400)
  }

  // 주차: 미지정이면 가장 최근 weekly_summaries 행 사용
  let weekStart = body.week_start_date
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    const latest = await c.env.DB.prepare(
      'SELECT week_start_date FROM weekly_summaries ORDER BY week_start_date DESC LIMIT 1'
    ).first<{ week_start_date: string }>()
    if (!latest) {
      return c.json({ success: false, error: '발송 가능한 위클리 요약이 없습니다. 먼저 위클리 발행을 진행해 주세요.' }, 400)
    }
    weekStart = latest.week_start_date
  }

  try {
    const row = await c.env.DB.prepare(
      'SELECT * FROM weekly_summaries WHERE week_start_date = ?'
    ).bind(weekStart).first<any>()
    if (!row) {
      return c.json({ success: false, error: `${weekStart} 의 위클리 요약을 찾을 수 없습니다.` }, 400)
    }

    // TOP3
    const top3Rows = await c.env.DB.prepare(
      'SELECT * FROM weekly_top_news WHERE week_start_date = ? ORDER BY rank ASC LIMIT 3'
    ).bind(weekStart).all<any>()
    const top3 = (top3Rows.results || []).map((r: any) => ({
      id: 0, week_start_date: weekStart, rank: r.rank,
      news_id: r.news_id ?? null, title: r.title,
      summary: null, link: r.link, source: r.source,
      category: r.category, created_at: '',
    })) as any

    // 운영자 업로드 이미지
    const sectionImages = await getSectionImageMap(c.env.DB)
    const topImageRows = await listWeeklyTopImages(c.env.DB, weekStart!)
    const topImages = topImageRows.map(t => ({
      slot: t.slot, image_url: t.image_url,
      caption: t.caption, link_url: t.link_url,
    }))

    // 설정
    const settingsMap = await getAllSettings(c.env.DB)
    const siteUrl = settingsMap[SETTING_KEYS.SITE_URL] || new URL(c.req.url).origin
    const logoUrl = settingsMap[SETTING_KEYS.COMPANY_LOGO_URL] || null
    const senderName = settingsMap[SETTING_KEYS.SENDER_NAME] || '모투스 위클리'

    // 메타
    const weekEnd = (() => {
      const d = new Date(weekStart + 'T00:00:00')
      d.setDate(d.getDate() + 6)
      return d.toISOString().slice(0, 10)
    })()
    const issueDate = row.issue_date || weekStart
    const issueLabelKo = formatIssueLabelKo(weekStart!)
    const weekRangeKo = formatWeekRangeKo(weekStart!, weekEnd)
    const nextDate = new Date(weekStart + 'T00:00:00')
    nextDate.setDate(nextDate.getDate() + 14)
    const nextIssueKo = `${nextDate.getFullYear()}년 ${nextDate.getMonth() + 1}월 ${nextDate.getDate()}일(월) 오전 7시`

    const html = renderWeeklyEmail({
      volNo: row.vol_no || 0,
      weekStart: weekStart!, weekEnd, issueDate,
      weekRangeKo, issueLabelKo, nextIssueKo,
      marketOneliner: row.market_oneliner || null,
      summaryMarkdown: row.content || '',
      top3,
      totalArticles: row.article_count || 0,
      companyContents: [],
      siteUrl,
      unsubscribeToken: 'test-preview',
      logoUrl,
      senderName,
      sectionImages,
      topImages,
    } as any)

    const subject = `[테스트·위클리] ${makeWeeklySubject(row.vol_no || 0, issueLabelKo, row.market_oneliner)}`
    const r = await sendEmail(c.env.DB, { to, subject, html }, { RESEND_API_KEY: c.env.RESEND_API_KEY })
    await logEmailSend(c.env.DB, null, to, weekStart!, 'success', `[TEST-WEEKLY] resend_id=${r.id || ''}`)

    return c.json({
      success: true,
      id: r.id,
      to,
      weekStart,
      sectionImagesApplied: Object.keys(sectionImages).length,
      topImagesApplied: topImages.length,
      volNo: row.vol_no || 0,
    })
  } catch (e: any) {
    const errMsg = e?.message || String(e)
    await logEmailSend(c.env.DB, null, to, weekStart!, 'failed', `[TEST-WEEKLY] ${errMsg}`).catch(() => {})
    return c.json({ success: false, error: errMsg }, 200)
  }
})

// === 뉴스 검색 (관리자) ===
admin.get('/news/search', async (c) => {
  const q = c.req.query('q')
  const group = c.req.query('group')
  const source = c.req.query('source')
  const start = c.req.query('start')
  const end = c.req.query('end')
  const sort = (c.req.query('sort') === 'relevance' ? 'relevance' : 'recent') as 'recent' | 'relevance'
  const page = parseInt(c.req.query('page') || '1')
  const pageSize = parseInt(c.req.query('pageSize') || '20')
  const result = await searchNews(c.env.DB, {
    q, group, source, startDate: start, endDate: end, sort, page, pageSize
  })
  return c.json(result)
})

admin.get('/news-sources', async (c) => {
  const items = await getAvailableSources(c.env.DB, 100)
  return c.json({ items })
})

// === 언론사 매핑 ===
admin.get('/media-mapping', async (c) => {
  const custom = await loadCustomMappings(c.env.DB)
  return c.json({
    custom,
    defaults: DEFAULT_MEDIA_MAPPINGS
  })
})

admin.put('/media-mapping', async (c) => {
  const body = await c.req.json<{ mappings?: Record<string, string> }>().catch(() => ({}))
  if (!body.mappings || typeof body.mappings !== 'object') {
    return c.json({ error: '매핑 객체가 필요합니다.' }, 400)
  }
  await saveMediaMappings(c.env.DB, body.mappings)
  return c.json({ success: true })
})

admin.post('/media-mapping/add', async (c) => {
  const body = await c.req.json<{ domain?: string; name?: string }>().catch(() => ({}))
  const domain = (body.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
  const name = (body.name || '').trim()
  if (!domain || !name) return c.json({ error: '도메인과 언론사명을 모두 입력하세요.' }, 400)

  const current = await loadCustomMappings(c.env.DB)
  current[domain] = name
  await saveMediaMappings(c.env.DB, current)
  return c.json({ success: true, domain, name })
})

admin.delete('/media-mapping/:domain', async (c) => {
  const domain = c.req.param('domain').toLowerCase()
  const current = await loadCustomMappings(c.env.DB)
  delete current[domain]
  await saveMediaMappings(c.env.DB, current)
  return c.json({ success: true })
})

// === 환경설정 ===
admin.get('/settings', async (c) => {
  const all = await getAllSettings(c.env.DB)
  // 비밀값 마스킹
  const masked: Record<string, string> = {}
  for (const [k, v] of Object.entries(all)) {
    if (k.includes('secret') || k.includes('password') || k.includes('api_key')) {
      masked[k] = v ? '••••••••' + v.slice(-4) : ''
      masked[k + '_set'] = v ? '1' : '0'
    } else {
      masked[k] = v
    }
  }
  return c.json({ settings: masked })
})

admin.put('/settings', async (c) => {
  const body = await c.req.json<Record<string, string>>().catch(() => ({}))
  // 빈값/마스킹값은 저장 X
  const filtered: Record<string, string> = {}
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === 'string' && v && !v.startsWith('••••')) {
      filtered[k] = v
    }
  }
  // 자동 실행 시각 검증 (둘 다 들어왔을 때)
  if (filtered[SETTING_KEYS.AUTO_COLLECT_TIME_KST] || filtered[SETTING_KEYS.AUTO_SEND_TIME_KST]) {
    const cur = await getAllSettings(c.env.DB)
    const collectT = filtered[SETTING_KEYS.AUTO_COLLECT_TIME_KST] || cur[SETTING_KEYS.AUTO_COLLECT_TIME_KST] || '06:30'
    const sendT = filtered[SETTING_KEYS.AUTO_SEND_TIME_KST] || cur[SETTING_KEYS.AUTO_SEND_TIME_KST] || '07:30'
    const v = validateAutoTimes(collectT, sendT)
    if (!v.ok) {
      return c.json({ success: false, error: v.error }, 400)
    }
  }
  await setSettings(c.env.DB, filtered)
  return c.json({ success: true })
})

// === 수집 카테고리 그룹 활성화 ===
admin.get('/collect-groups', async (c) => {
  const enabled = await getEnabledCategoryGroups(c.env.DB)
  return c.json({ enabled })
})

admin.put('/collect-groups', async (c) => {
  const body = await c.req.json<{ enabled?: Record<string, boolean> }>().catch(() => ({}))
  if (!body.enabled || typeof body.enabled !== 'object') {
    return c.json({ success: false, error: 'enabled 필드가 필요합니다.' }, 400)
  }
  await setEnabledCategoryGroups(c.env.DB, body.enabled as any)
  const updated = await getEnabledCategoryGroups(c.env.DB)
  return c.json({ success: true, enabled: updated })
})

// === 자동 실행 (Cron) 관리 ===
admin.get('/auto-job/status', async (c) => {
  const cfg = await loadAutoJobConfig(c.env.DB)
  const lastCollect = await getLastAutoJobLog(c.env.DB, 'collect')
  const lastSend = await getLastAutoJobLog(c.env.DB, 'send')
  const todayCollectDone = await hasCompletedToday(c.env.DB, 'collect')
  const todaySendDone = await hasCompletedToday(c.env.DB, 'send')
  return c.json({
    config: cfg,
    nextRun: {
      collect: getNextRunKST(cfg.collectTime),
      send: getNextRunKST(cfg.sendTime),
    },
    lastResult: {
      collect: lastCollect,
      send: lastSend,
    },
    today: {
      collectCompleted: todayCollectDone,
      sendCompleted: todaySendDone,
    }
  })
})

admin.get('/auto-job/logs', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50')
  const logs = await getAutoJobLogs(c.env.DB, limit)
  return c.json({ logs })
})

// Cron 테스트 실행 (즉시 자동 작업 실행 - cron-test trigger로 기록)
admin.post('/auto-job/test/:type', async (c) => {
  const type = c.req.param('type')
  const env = { RESEND_API_KEY: c.env.RESEND_API_KEY }
  if (type === 'collect') {
    const log = await runAutoCollect(c.env.DB, env, 'cron-test')
    return c.json({ success: true, log })
  }
  if (type === 'send') {
    const log = await runAutoSend(c.env.DB, env, 'cron-test')
    return c.json({ success: true, log })
  }
  return c.json({ success: false, error: 'type 은 collect | send 이어야 합니다.' }, 400)
})

// === 발송 작업(send_jobs) 조회 API ===
admin.get('/send-jobs', async (c) => {
  const limit = parseInt(c.req.query('limit') || '30')
  const jobs = await listSendJobs(c.env.DB, limit)
  return c.json({ jobs })
})

admin.get('/send-jobs/:jobId', async (c) => {
  const jobId = c.req.param('jobId')
  const job = await getSendJob(c.env.DB, jobId)
  if (!job) return c.json({ error: '발송 작업을 찾을 수 없습니다.' }, 404)
  const logs = await getEmailSendLogsByJob(c.env.DB, jobId)
  const failed = await getFailedRecipients(c.env.DB, jobId)
  return c.json({ job, logs, failed })
})

admin.get('/send-jobs/today/info', async (c) => {
  const date = todayKST()
  const jobId = makeJobId(date)
  const job = await getSendJob(c.env.DB, jobId)
  return c.json({ date, jobId, job })
})

// ============================================================
// 위클리 이벤트 캘린더 (weekly_events) — 관리자 직접 입력
// ============================================================
// 기본 week_start_date 결정 규칙:
//   - 쿼리/바디에 week_start_date 가 명시되어 있으면 사용
//   - 명시 없으면 "이번 호" 기준 (= getLastWeekRange().issueDate = 이번 주 월요일)
function resolveWeekStart(input?: string | null): string {
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) return getWeekStartOf(input)
  // 이번 호 = 이번 주 월요일 (위클리는 매주 월요일에 직전 주 데이터를 발행)
  // 하지만 "이번 주 일정 / 다음 주 일정"의 노출 기준이 되는 호는 issueDate(이번 주 월요일)
  return getLastWeekRange().issueDate
}

// 목록 조회: GET /admin/api/weekly-events?week=YYYY-MM-DD&section=this_week|next_week
admin.get('/weekly-events', async (c) => {
  const weekQ = c.req.query('week')
  const section = c.req.query('section') as ('this_week' | 'next_week' | undefined)
  const weekStart = resolveWeekStart(weekQ || null)
  const events = await listWeeklyEvents(c.env.DB, weekStart, section)
  const counts = await countWeeklyEventsByWeek(c.env.DB, weekStart)
  return c.json({ week_start_date: weekStart, counts, events })
})

// 단건 조회: GET /admin/api/weekly-events/:id
admin.get('/weekly-events/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'id 가 올바르지 않습니다.' }, 400)
  const ev = await getWeeklyEvent(c.env.DB, id)
  if (!ev) return c.json({ error: '이벤트를 찾을 수 없습니다.' }, 404)
  return c.json({ event: ev })
})

// 생성: POST /admin/api/weekly-events
admin.post('/weekly-events', async (c) => {
  const body = await c.req.json<Partial<WeeklyEventInput>>().catch(() => ({} as any))
  if (!body || !body.title || !body.section || !body.event_type) {
    return c.json({ error: 'title / section / event_type 은 필수입니다.' }, 400)
  }
  const input: WeeklyEventInput = {
    week_start_date: body.week_start_date || resolveWeekStart(null),
    section: body.section,
    event_type: body.event_type,
    event_date: body.event_date || null,
    title: body.title,
    description: body.description || null,
    category: body.category || null,
    sort_order: body.sort_order ?? 0,
  }
  try {
    const id = await createWeeklyEvent(c.env.DB, input)
    return c.json({ success: true, id })
  } catch (e: any) {
    return c.json({ error: e?.message || '이벤트 생성 실패' }, 400)
  }
})

// 수정: PUT /admin/api/weekly-events/:id
admin.put('/weekly-events/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'id 가 올바르지 않습니다.' }, 400)
  const body = await c.req.json<Partial<WeeklyEventInput>>().catch(() => ({} as any))
  try {
    await updateWeeklyEvent(c.env.DB, id, body)
    const updated = await getWeeklyEvent(c.env.DB, id)
    return c.json({ success: true, event: updated })
  } catch (e: any) {
    return c.json({ error: e?.message || '이벤트 수정 실패' }, 400)
  }
})

// 삭제: DELETE /admin/api/weekly-events/:id
admin.delete('/weekly-events/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'id 가 올바르지 않습니다.' }, 400)
  const ev = await getWeeklyEvent(c.env.DB, id)
  if (!ev) return c.json({ error: '이벤트를 찾을 수 없습니다.' }, 404)
  await deleteWeeklyEvent(c.env.DB, id)
  return c.json({ success: true })
})

// ════════════════════════════════════════════════════════════════════
// 정치 필터 — 격리 기사 조회 / 운영 리포트
// ════════════════════════════════════════════════════════════════════

// GET /admin/api/excluded-articles?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=100
admin.get('/excluded-articles', async (c) => {
  const from = c.req.query('from')
  const to = c.req.query('to')
  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500)

  let sql = 'SELECT id, title, source, link, category, collection_date, excluded_reason, matched_keywords, matched_politicians, matched_url_patterns, created_at FROM excluded_articles'
  const binds: any[] = []
  const where: string[] = []
  if (from) { where.push('collection_date >= ?'); binds.push(from) }
  if (to) { where.push('collection_date <= ?'); binds.push(to) }
  if (where.length) sql += ' WHERE ' + where.join(' AND ')
  sql += ' ORDER BY collection_date DESC, id DESC LIMIT ?'
  binds.push(limit)

  const rows = await c.env.DB.prepare(sql).bind(...binds).all()

  // JSON 컬럼 파싱
  const items = (rows.results || []).map((r: any) => ({
    ...r,
    matched_keywords: safeJsonParse(r.matched_keywords),
    matched_politicians: safeJsonParse(r.matched_politicians),
    matched_url_patterns: safeJsonParse(r.matched_url_patterns),
  }))

  return c.json({ items, count: items.length })
})

// GET /admin/api/filter-report?from=YYYY-MM-DD&to=YYYY-MM-DD
// 운영 리포트: 수집 대비 격리 비율 + 카테고리 분포 + 키워드 매칭 상위
admin.get('/filter-report', async (c) => {
  const from = c.req.query('from')
  const to = c.req.query('to')
  const where: string[] = []
  const binds: any[] = []
  if (from) { where.push('collection_date >= ?'); binds.push(from) }
  if (to) { where.push('collection_date <= ?'); binds.push(to) }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : ''

  // 수집된 정상 기사 수 (news 테이블)
  const newsCount = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM news${whereSql}`)
    .bind(...binds).first<{ n: number }>()
  // 격리 기사 수
  const excludedCount = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM excluded_articles${whereSql}`)
    .bind(...binds).first<{ n: number }>()
  // 카테고리별 격리 분포
  const byCategory = await c.env.DB.prepare(
    `SELECT category, COUNT(*) AS n FROM excluded_articles${whereSql} GROUP BY category ORDER BY n DESC`
  ).bind(...binds).all<{ category: string; n: number }>()
  // 격리된 기사의 매칭 키워드 빈도 (matched_keywords JSON 배열 풀어서)
  const allMatched = await c.env.DB.prepare(
    `SELECT matched_keywords, matched_politicians, matched_url_patterns FROM excluded_articles${whereSql}`
  ).bind(...binds).all<{ matched_keywords: string; matched_politicians: string; matched_url_patterns: string }>()

  const keywordFreq: Record<string, number> = {}
  const politicianFreq: Record<string, number> = {}
  const urlPatternFreq: Record<string, number> = {}
  for (const row of allMatched.results || []) {
    for (const k of safeJsonParse(row.matched_keywords) || []) keywordFreq[k] = (keywordFreq[k] || 0) + 1
    for (const p of safeJsonParse(row.matched_politicians) || []) politicianFreq[p] = (politicianFreq[p] || 0) + 1
    for (const u of safeJsonParse(row.matched_url_patterns) || []) urlPatternFreq[u] = (urlPatternFreq[u] || 0) + 1
  }

  const totalAttempt = (newsCount?.n || 0) + (excludedCount?.n || 0)
  const excludeRatio = totalAttempt > 0 ? (excludedCount?.n || 0) / totalAttempt : 0

  return c.json({
    range: { from: from || null, to: to || null },
    counts: {
      news_saved: newsCount?.n || 0,
      excluded: excludedCount?.n || 0,
      total_attempt: totalAttempt,
      exclude_ratio: Number(excludeRatio.toFixed(4)),
    },
    by_category: byCategory.results || [],
    top_keywords: Object.entries(keywordFreq).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, n]) => ({ keyword: k, count: n })),
    top_politicians: Object.entries(politicianFreq).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, n]) => ({ name: k, count: n })),
    top_url_patterns: Object.entries(urlPatternFreq).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, n]) => ({ pattern: k, count: n })),
  })
})

function safeJsonParse(s: string | null | undefined): any[] {
  if (!s) return []
  try { return JSON.parse(s) } catch { return [] }
}

// ─────────────────────────────────────────────────────────────────────────
// 수신자 맞춤화 (회사 프로필) — 0009 마이그레이션 후 사용 가능
// ─────────────────────────────────────────────────────────────────────────

/** GET /admin/api/company-profiles — 등록된 회사 프로필 목록 */
admin.get('/company-profiles', async (c) => {
  const profiles = Object.values(COMPANY_PROFILES).map(p => ({
    key: p.key,
    displayName: p.displayName,
    focusKeywords: p.focusKeywords,
    competitorKeywords: p.competitorKeywords,
    watchRegions: p.watchRegions,
    sectionHeader: p.sectionHeader,
    minSelfKeywordOccurrences: p.minSelfKeywordOccurrences,
    minCompetitorCompanies: p.minCompetitorCompanies,
  }))
  return c.json({ profiles })
})

/** GET /admin/api/company-profiles/:key — 특정 회사 프로필 상세 */
admin.get('/company-profiles/:key', async (c) => {
  const p = getCompanyProfile(c.req.param('key'))
  if (!p) return c.json({ error: 'Profile not found' }, 404)
  return c.json(p)
})

/**
 * PUT /admin/api/subscribers/:id/profile — 수신자 프로필 업데이트
 * body: { company?, company_profile?, focus_keywords?[], competitor_keywords?[], watch_regions?[] }
 */
admin.put('/subscribers/:id/profile', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: '잘못된 id' }, 400)
  const body = await c.req.json().catch(() => ({}))
  // company_profile 유효성 검증 (null도 허용 — 일반본으로 되돌림)
  if (body.company_profile !== undefined && body.company_profile !== null) {
    if (!COMPANY_PROFILES[body.company_profile]) {
      return c.json({ error: `알 수 없는 company_profile: ${body.company_profile}` }, 400)
    }
  }
  const ok = await updateSubscriberProfile(c.env.DB, id, body)
  if (!ok) return c.json({ error: '업데이트 실패 (구독자가 없거나 변경 필드 없음)' }, 404)
  const sub = await getSubscriberById(c.env.DB, id)
  return c.json({ success: true, subscriber: sub })
})

/** GET /admin/api/subscribers/:id — 단건 조회 (프로필 포함) */
admin.get('/subscribers/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: '잘못된 id' }, 400)
  const sub = await getSubscriberById(c.env.DB, id)
  if (!sub) return c.json({ error: 'Not found' }, 404)
  // 적용될 프로필도 함께 반환
  const profile = profileFromSubscriberRow(sub)
  return c.json({ subscriber: sub, effective_profile: profile })
})

/**
 * POST /admin/api/personalized-weekly/generate
 * body: { week_start_date: 'YYYY-MM-DD', company_profile: 'gs', dry_run?: boolean }
 * - week_start_date 주의 news 데이터 + 일반본 TOP3로 회사 맞춤 위클리 생성
 * - dry_run=true 면 LLM 호출만 하고 DB 저장 안 함 (검증만)
 */
admin.post('/personalized-weekly/generate', async (c) => {
  const body = await c.req.json<{
    week_start_date?: string
    company_profile?: string
    dry_run?: boolean
  }>().catch(() => ({}))

  const weekStart = body.week_start_date
  const profileKey = body.company_profile
  const dryRun = !!body.dry_run

  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return c.json({ error: 'week_start_date(YYYY-MM-DD) 필수' }, 400)
  }
  const profile = getCompanyProfile(profileKey)
  if (!profile) return c.json({ error: `유효하지 않은 company_profile: ${profileKey}` }, 400)

  const db = c.env.DB

  // 1) 주간 뉴스 조회
  const weekEnd = (() => {
    const d = new Date(weekStart + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + 6)
    return d.toISOString().slice(0, 10)
  })()

  const newsRes = await db.prepare(`
    SELECT id, title, description, link, source, pub_date, category, collection_date
    FROM news
    WHERE collection_date BETWEEN ? AND ?
    ORDER BY collection_date DESC, id DESC
  `).bind(weekStart, weekEnd).all<any>()
  const newsList = newsRes.results || []

  if (newsList.length === 0) {
    return c.json({ error: `${weekStart} ~ ${weekEnd} 기간 뉴스 데이터가 없습니다.` }, 404)
  }

  // 2) 일반본의 TOP3 가져오기 (있으면)
  const top3Rows = await db.prepare(
    'SELECT * FROM weekly_top_news WHERE week_start_date = ? ORDER BY rank ASC'
  ).bind(weekStart).all<any>()
  const top3 = (top3Rows.results || []).map((r: any) => ({
    rank: r.rank,
    group: r.category || '-',
    news: {
      id: r.news_id, title: r.title, link: r.link, source: r.source, category: r.category,
      description: null, pub_date: null, collection_date: null,
    } as any,
  }))

  // 3) LLM 호출하여 맞춤본 생성
  let content: string
  try {
    content = await generateWeeklySummary(db, weekStart, weekEnd, top3, newsList, profile)
  } catch (e: any) {
    return c.json({ error: 'LLM 호출 실패', detail: String(e?.message || e) }, 500)
  }

  // 4) 검증
  const verification = verifyCompanySummary(content, profile)
  const marketOneliner = extractMarketOneliner(content)
  const today = new Date().toISOString().slice(0, 10)
  const status: 'ready' | 'held' = verification.passed ? 'ready' : 'held'

  // 5) 저장 (dry_run=false일 때만)
  let saved = false
  if (!dryRun) {
    const r = await savePersonalizedWeeklySummary({
      db, weekStart, weekEnd,
      companyProfile: profile.key,
      issueDate: today,
      content,
      marketOneliner,
      articleCount: newsList.length,
      verification: JSON.stringify(verification),
      status,
    })
    saved = true
    console.log(`[admin] personalized-weekly saved: ${profile.key} ${weekStart} (isNew=${r.isNew}, status=${status})`)
  }

  return c.json({
    success: true,
    week_start_date: weekStart,
    week_end_date: weekEnd,
    company_profile: profile.key,
    article_count: newsList.length,
    market_oneliner: marketOneliner,
    content,
    verification,
    status,
    saved,
    dry_run: dryRun,
  })
})

/**
 * GET /admin/api/personalized-weekly?week_start_date=YYYY-MM-DD&company_profile=gs
 * 저장된 맞춤 위클리 조회
 */
admin.get('/personalized-weekly', async (c) => {
  const weekStart = c.req.query('week_start_date')
  const profileKey = c.req.query('company_profile')
  if (!weekStart || !profileKey) {
    return c.json({ error: 'week_start_date, company_profile 쿼리 필수' }, 400)
  }
  const row = await getPersonalizedWeeklySummary(c.env.DB, weekStart, profileKey)
  if (!row) return c.json({ error: 'Not found' }, 404)
  let verification: any = null
  try { verification = row.verification ? JSON.parse(row.verification) : null } catch { /* ignore */ }
  return c.json({ ...row, verification })
})

/**
 * POST /admin/api/personalized-weekly/verify
 * body: { content: '<markdown>', company_profile: 'gs' }
 * — 임의의 마크다운 본문을 받아 회사 검증만 수행 (저장 X, LLM 호출 X)
 */
admin.post('/personalized-weekly/verify', async (c) => {
  const body = await c.req.json<{ content?: string; company_profile?: string }>().catch(() => ({}))
  if (!body.content || !body.company_profile) {
    return c.json({ error: 'content, company_profile 필수' }, 400)
  }
  const profile = getCompanyProfile(body.company_profile)
  if (!profile) return c.json({ error: `유효하지 않은 company_profile: ${body.company_profile}` }, 400)
  const result = verifyCompanySummary(body.content, profile)
  return c.json({ company_profile: profile.key, ...result })
})

// ─────────────────────────────────────────────────────────────────────────
// 운영 권고 반영: 추가 엔드포인트
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /admin/api/personalized-weekly/list?week_start_date=YYYY-MM-DD
 * — 특정 주차에 저장된 모든 회사 맞춤본 목록 (관리 대시보드용)
 */
admin.get('/personalized-weekly/list', async (c) => {
  const weekStart = c.req.query('week_start_date')
  if (!weekStart) return c.json({ error: 'week_start_date 쿼리 필수' }, 400)
  const rows = await listPersonalizedWeeklySummariesByWeek(c.env.DB, weekStart)
  return c.json({
    week_start_date: weekStart,
    count: rows.length,
    items: rows.map(r => ({
      ...r,
      verification: r.verification ? safeJsonObject(r.verification) : null,
    })),
  })
})

/**
 * POST /admin/api/personalized-weekly/review
 * body: { week_start_date, company_profile, status: 'approved'|'rejected'|'pending', notes? }
 * — 운영자 1차 검수 결과 기록 (자동 검증 통과 후 발송 직전 단계)
 *
 * 운영 흐름:
 *   1) /generate → 자동검증 통과 시 status='ready'
 *   2) 운영자가 본문 읽고 부정 사실 누락 등을 검토
 *   3) /review 로 approved 등록 → status='approved' → 발송 가능
 *   4) 부정 사실 누락 시 rejected → status='held' → /generate 재실행
 */
admin.post('/personalized-weekly/review', async (c) => {
  const body = await c.req.json<{
    week_start_date?: string
    company_profile?: string
    status?: 'approved' | 'rejected' | 'pending'
    notes?: string | null
  }>().catch(() => ({}))

  if (!body.week_start_date || !body.company_profile || !body.status) {
    return c.json({ error: 'week_start_date, company_profile, status 필수' }, 400)
  }
  if (!['approved', 'rejected', 'pending'].includes(body.status)) {
    return c.json({ error: "status 는 approved | rejected | pending" }, 400)
  }

  // 검수 대상이 자동검증 통과 상태인지 확인
  const existing = await getPersonalizedWeeklySummary(c.env.DB, body.week_start_date, body.company_profile)
  if (!existing) return c.json({ error: '대상 위클리가 존재하지 않습니다.' }, 404)

  // 자동검증 미통과(held) 본문은 approved 처리 차단 (강제로 보내려면 /generate 재실행 필요)
  if (body.status === 'approved' && existing.status === 'held') {
    return c.json({
      error: "자동검증을 통과하지 못한 본문(status='held')은 운영자 승인 불가. 본문 재생성이 필요합니다.",
      automated_verification: existing.verification ? safeJsonObject(existing.verification) : null,
    }, 409)
  }

  const adminId = (c.get as any)('adminId') || 0
  const r = await setOperatorReview(c.env.DB, {
    weekStart: body.week_start_date,
    companyProfile: body.company_profile,
    status: body.status,
    notes: body.notes ?? null,
    reviewedBy: adminId,
  })

  return c.json({
    success: r.ok,
    week_start_date: body.week_start_date,
    company_profile: body.company_profile,
    review_status: body.status,
    new_row_status: r.newStatus,
  })
})

/** GET /admin/api/personalized-weekly/pending-reviews — 운영자 검수 대기 목록 */
admin.get('/personalized-weekly/pending-reviews', async (c) => {
  const rows = await listPendingOperatorReviews(c.env.DB)
  return c.json({
    count: rows.length,
    items: rows.map(r => ({
      week_start_date: r.week_start_date,
      week_end_date: r.week_end_date,
      company_profile: r.company_profile,
      vol_no: r.vol_no,
      issue_date: r.issue_date,
      market_oneliner: r.market_oneliner,
      article_count: r.article_count,
      status: r.status,
      verification: r.verification ? safeJsonObject(r.verification) : null,
      created_at: r.created_at,
    })),
  })
})

/**
 * POST /admin/api/personalized-weekly/send
 * body: { week_start_date, company_profile?, force_unreviewed?, dry_run? }
 * — 회사 맞춤본 발송 (운영자 검수 통과본만)
 * - company_profile 미지정 → 해당 주차 모든 회사 일괄 발송
 * - force_unreviewed=true → status='ready'도 발송 허용 (긴급 대응)
 * - dry_run=true → 대상자 수와 본문 status만 점검, 실제 발송 X
 */
admin.post('/personalized-weekly/send', async (c) => {
  // 큐 지연 진단용: 요청 진입 시각을 UTC ISO로 기록
  // 이 값과 send_jobs.started_at 의 차이가 "관리자 → 큐 시작 사이의 지연" 이다.
  const apiEnteredAt = new Date().toISOString()
  console.log(`[즉시발송] /personalized-weekly/send 진입 (UTC=${apiEnteredAt})`)

  const body = await c.req.json<{
    week_start_date?: string
    company_profile?: string
    force_unreviewed?: boolean
    /** 'completed' 상태도 우회하여 재발송 (운영자 명시적 재발송) */
    force?: boolean
    dry_run?: boolean
  }>().catch(() => ({}))

  if (!body.week_start_date) return c.json({ error: 'week_start_date 필수' }, 400)
  const env = c.env as any
  if (body.force) {
    console.log(`[/personalized-weekly/send] ⚡ 운영자 force 재발송 요청 수신 (week=${body.week_start_date}, company=${body.company_profile || 'ALL'})`)
  }

  // dry_run: 대상 검사만
  if (body.dry_run) {
    const rows = body.company_profile
      ? [await getPersonalizedWeeklySummary(c.env.DB, body.week_start_date, body.company_profile)].filter(Boolean) as any[]
      : await listPersonalizedWeeklySummariesByWeek(c.env.DB, body.week_start_date)

    const report = [] as any[]
    for (const row of rows) {
      const subs = await listSubscribersByCompanyProfile(c.env.DB, row.company_profile)
      const canSend = row.status === 'approved' || (body.force_unreviewed && row.status === 'ready')
      report.push({
        company_profile: row.company_profile,
        status: row.status,
        operator_review_status: (row as any).operator_review_status,
        target_subscribers: subs.length,
        can_send: canSend,
      })
    }
    return c.json({ dry_run: true, week_start_date: body.week_start_date, plan: report })
  }

  if (body.company_profile) {
    const jobStartedAt = new Date().toISOString()
    const delayMs = new Date(jobStartedAt).getTime() - new Date(apiEnteredAt).getTime()
    console.log(`[즉시발송] runPersonalizedWeeklyJob 호출 직전 (UTC=${jobStartedAt}, API진입→호출 지연=${delayMs}ms)`)
    const r = await runPersonalizedWeeklyJob(
      c.env.DB,
      {
        weekStart: body.week_start_date,
        companyProfile: body.company_profile,
        forceUnreviewed: !!body.force_unreviewed,
        force: !!body.force,
        trigger: 'manual',
      },
      env,
    )
    const finishedAt = new Date().toISOString()
    const totalMs = new Date(finishedAt).getTime() - new Date(apiEnteredAt).getTime()
    console.log(`[즉시발송] 종료 (UTC=${finishedAt}, 총 ${totalMs}ms = ${(totalMs/1000).toFixed(1)}초)`)
    return c.json({
      success: true,
      result: r,
      timing: { api_entered_at: apiEnteredAt, job_started_at: jobStartedAt, finished_at: finishedAt, queue_delay_ms: delayMs, total_ms: totalMs },
    })
  } else {
    const jobStartedAt = new Date().toISOString()
    const delayMs = new Date(jobStartedAt).getTime() - new Date(apiEnteredAt).getTime()
    console.log(`[즉시발송] runAllPersonalizedWeeklyJobs 호출 직전 (UTC=${jobStartedAt}, API진입→호출 지연=${delayMs}ms)`)
    const results = await runAllPersonalizedWeeklyJobs(
      c.env.DB,
      {
        weekStart: body.week_start_date,
        trigger: 'manual',
        forceUnreviewed: !!body.force_unreviewed,
        force: !!body.force,
      },
      env,
    )
    const finishedAt = new Date().toISOString()
    const totalMs = new Date(finishedAt).getTime() - new Date(apiEnteredAt).getTime()
    const summary = {
      total_companies: results.length,
      total_sent: results.reduce((s, r) => s + r.sent, 0),
      total_failed: results.reduce((s, r) => s + r.failed, 0),
    }
    console.log(`[즉시발송] 일괄 종료 (UTC=${finishedAt}, 총 ${totalMs}ms = ${(totalMs/1000).toFixed(1)}초, 회사 ${results.length}건)`)
    return c.json({
      success: true,
      summary,
      results,
      timing: { api_entered_at: apiEnteredAt, job_started_at: jobStartedAt, finished_at: finishedAt, queue_delay_ms: delayMs, total_ms: totalMs },
    })
  }
})

/**
 * POST /admin/api/subscribers/import
 * body: { csv: '<csv text>' }   또는  Content-Type: text/csv (body raw)
 * — CSV 일괄 등록 (UPSERT)
 *
 * CSV 헤더: email,name,company,company_profile
 */
admin.post('/subscribers/import', async (c) => {
  let csvText = ''
  const contentType = c.req.header('content-type') || ''
  if (contentType.includes('application/json')) {
    const body = await c.req.json<{ csv?: string }>().catch(() => ({}))
    csvText = body.csv || ''
  } else {
    csvText = await c.req.text()
  }

  if (!csvText.trim()) return c.json({ error: 'csv 본문이 비어있습니다.' }, 400)

  const { rows, errors: parseErrors } = parseSubscribersCsv(csvText)
  // company_profile 유효성 사전 점검
  const validatedRows = rows.filter((r, idx) => {
    if (r.company_profile && !getCompanyProfile(r.company_profile)) {
      parseErrors.push({ line: idx + 2, reason: `유효하지 않은 company_profile: ${r.company_profile}` })
      return false
    }
    return true
  })

  const result = await bulkUpsertSubscribers(c.env.DB, validatedRows, parseErrors)
  return c.json(result)
})

/** GET /admin/api/company-profile-stats — 회사 프로필별 활성 구독자 통계
 *   (라우트 충돌 회피: /subscribers/:id 가 'company-stats'를 id로 해석하는 문제)
 */
admin.get('/company-profile-stats', async (c) => {
  const stats = await getCompanyProfileStats(c.env.DB)
  // 프로필 메타와 결합
  const enriched = stats.map(s => {
    const meta = s.company_profile !== '_general' ? getCompanyProfile(s.company_profile) : null
    return {
      company_profile: s.company_profile,
      company: s.company,
      display_name: meta?.displayName || (s.company_profile === '_general' ? '(일반 구독자)' : s.company_profile),
      count: s.count,
    }
  })
  return c.json({ stats: enriched })
})

/**
 * GET /admin/api/llm-status
 * — Claude API 키 등 LLM 호출 가능 여부 진단 (마스킹된 상태만 반환)
 */
admin.get('/llm-status', async (c) => {
  const claudeKey = await getSetting(c.env.DB, SETTING_KEYS.CLAUDE_API_KEY)
  const keyConfigured = !!claudeKey && claudeKey.length > 10
  const keyPreview = keyConfigured ? `${claudeKey!.slice(0, 7)}...${claudeKey!.slice(-4)}` : null
  return c.json({
    claude_api_key_configured: keyConfigured,
    claude_api_key_preview: keyPreview,
    setup_instructions: keyConfigured ? null : {
      web_ui: '관리자 설정 > Claude API Key 입력 (sk-ant-...)',
      wrangler_secret: 'wrangler secret put CLAUDE_API_KEY  (또는 admin settings 페이지에서 등록)',
      env_var: 'CLAUDE_API_KEY (Cloudflare Pages > Settings > Environment variables)',
    },
  })
})

// 안전한 JSON 파싱 헬퍼 (object/null 반환)
function safeJsonObject(s: string): any {
  try { return JSON.parse(s) } catch { return null }
}

// ════════════════════════════════════════════════════════════════════
// 위클리 이미지 관리 API
// ════════════════════════════════════════════════════════════════════

/**
 * GET /admin/api/weekly-images/section-meta
 * — 관리 가능한 섹션 키 + 메타 정보 (UI 빌드용)
 */
admin.get('/weekly-images/section-meta', async (c) => {
  return c.json({
    keys: MANAGEABLE_SECTION_KEYS,
    meta: SECTION_KEY_META,
  })
})

/**
 * GET /admin/api/weekly-images/sections
 * — 카테고리 대표 이미지 전체 조회
 */
admin.get('/weekly-images/sections', async (c) => {
  const rows = await listSectionImages(c.env.DB)
  // 모든 관리 가능 키에 대해 (존재하지 않는 키도) 자리 표시
  const map: Record<string, any> = {}
  for (const k of MANAGEABLE_SECTION_KEYS) map[k] = null
  for (const r of rows) map[r.section_key] = r
  return c.json({ sections: map, manageable_keys: MANAGEABLE_SECTION_KEYS, meta: SECTION_KEY_META })
})

/**
 * POST /admin/api/weekly-images/sections/:key
 * — multipart/form-data: file=<image>, alt_text=<선택>
 * — 또는 application/json: { image_url, alt_text }
 */
admin.post('/weekly-images/sections/:key', async (c) => {
  const key = c.req.param('key')
  if (!MANAGEABLE_SECTION_KEYS.includes(key as any)) {
    return c.json({ error: `유효하지 않은 section_key: ${key}` }, 400)
  }
  const adminId = c.get('adminId') as number | undefined

  const ct = c.req.header('content-type') || ''
  let imageUrl: string | undefined
  let imageKey: string | null = null
  let altText: string | null = null
  let oldR2Key: string | null = null

  // 기존 이미지의 R2 key (교체 시 정리용)
  const existing = await c.env.DB.prepare(
    'SELECT image_key FROM section_images WHERE section_key = ?'
  ).bind(key).first<{ image_key: string | null }>()
  oldR2Key = existing?.image_key || null

  if (ct.includes('multipart/form-data')) {
    if (!c.env.R2) {
      return c.json({
        error: 'R2 스토리지가 연결되어 있지 않습니다.',
        detail: 'Cloudflare R2 binding(R2)이 활성화되지 않았습니다. wrangler.jsonc 확인 필요.',
      }, 503)
    }
    let formData: FormData
    try {
      formData = await c.req.formData()
    } catch (e: any) {
      console.error('[upload section] formData parse failed:', e?.message)
      return c.json({
        error: 'multipart/form-data 파싱 실패',
        detail: e?.message || String(e),
      }, 400)
    }
    const file = formData.get('file') as File | null
    altText = (formData.get('alt_text') as string) || null
    if (!file || typeof file === 'string') {
      return c.json({ error: '파일이 없습니다.', detail: 'form 필드 "file"이 비어있습니다.' }, 400)
    }
    // 파일 크기 검증 (10MB 한도)
    const MAX_BYTES = 10 * 1024 * 1024
    if (file.size > MAX_BYTES) {
      return c.json({
        error: `파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(2)}MB)`,
        detail: `최대 ${MAX_BYTES / 1024 / 1024}MB까지 허용됩니다. 클라이언트에서 자동 리사이즈되어야 했으나 실패한 것으로 보입니다.`,
        size: file.size,
        filename: file.name,
      }, 413)
    }
    // MIME 검증
    if (file.type && !/^image\//i.test(file.type)) {
      return c.json({
        error: '이미지 파일만 업로드 가능합니다.',
        detail: `현재 Content-Type: ${file.type}`,
      }, 400)
    }
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
    imageKey = `uploads/weekly-section/${key}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${ext}`
    let arrayBuffer: ArrayBuffer
    try {
      arrayBuffer = await file.arrayBuffer()
    } catch (e: any) {
      console.error('[upload section] arrayBuffer failed:', e?.message)
      return c.json({
        error: '파일 본문 읽기 실패',
        detail: e?.message || String(e),
      }, 500)
    }
    try {
      await c.env.R2.put(imageKey, arrayBuffer, {
        httpMetadata: { contentType: file.type || 'application/octet-stream' }
      })
    } catch (e: any) {
      console.error('[upload section] R2.put failed:', e?.message, 'key=', imageKey, 'size=', arrayBuffer.byteLength)
      return c.json({
        error: 'R2 업로드 실패',
        detail: e?.message || String(e),
        filename: file.name,
        size: arrayBuffer.byteLength,
        r2_key: imageKey,
      }, 500)
    }
    imageUrl = `/r2/${imageKey}`
    console.log(`[upload section] OK key=${key} r2_key=${imageKey} size=${arrayBuffer.byteLength} type=${file.type}`)
  } else {
    // JSON: 외부 URL 직접 지정 (테스트/개발용)
    const body = await c.req.json<{ image_url?: string; alt_text?: string }>().catch(() => ({}))
    if (!body.image_url) return c.json({ error: 'image_url 필수' }, 400)
    imageUrl = body.image_url
    altText = body.alt_text || null
  }

  await upsertSectionImage({
    db: c.env.DB,
    sectionKey: key,
    imageUrl: imageUrl!,
    imageKey,
    altText,
    updatedBy: adminId ?? null,
  })

  // 이전 R2 객체 청소 (best effort, 새 키와 다를 때만)
  if (oldR2Key && oldR2Key !== imageKey) {
    await tryDeleteR2Object(c.env.R2, oldR2Key)
  }

  return c.json({ success: true, section_key: key, image_url: imageUrl, image_key: imageKey })
})

/** DELETE /admin/api/weekly-images/sections/:key */
admin.delete('/weekly-images/sections/:key', async (c) => {
  const key = c.req.param('key')
  if (!MANAGEABLE_SECTION_KEYS.includes(key as any)) {
    return c.json({ error: `유효하지 않은 section_key: ${key}` }, 400)
  }
  const r2Key = await deleteSectionImage(c.env.DB, key)
  await tryDeleteR2Object(c.env.R2, r2Key)
  return c.json({ success: true, section_key: key, deleted_r2_key: r2Key })
})

/**
 * GET /admin/api/weekly-images/top?week_start_date=YYYY-MM-DD
 * — 호별 TOP 이미지 조회 (slot 1~2)
 */
admin.get('/weekly-images/top', async (c) => {
  const weekStart = c.req.query('week_start_date')
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return c.json({ error: 'week_start_date(YYYY-MM-DD) 필수' }, 400)
  }
  const rows = await listWeeklyTopImages(c.env.DB, weekStart)
  const slots: Record<string, any> = { '1': null, '2': null }
  for (const r of rows) slots[String(r.slot)] = r
  return c.json({ week_start_date: weekStart, slots })
})

/**
 * POST /admin/api/weekly-images/top
 * — multipart: file, week_start_date, slot(1|2), caption, link_url
 * — JSON:      { week_start_date, slot, image_url, caption?, link_url? }
 */
admin.post('/weekly-images/top', async (c) => {
  const adminId = c.get('adminId') as number | undefined
  const ct = c.req.header('content-type') || ''
  let weekStart: string | undefined
  let slot: 1 | 2 | undefined
  let imageUrl: string | undefined
  let imageKey: string | null = null
  let caption: string | null = null
  let linkUrl: string | null = null

  if (ct.includes('multipart/form-data')) {
    if (!c.env.R2) {
      return c.json({
        error: 'R2 스토리지가 연결되어 있지 않습니다.',
        detail: 'Cloudflare R2 binding(R2)이 활성화되지 않았습니다.',
      }, 503)
    }
    let formData: FormData
    try {
      formData = await c.req.formData()
    } catch (e: any) {
      console.error('[upload top] formData parse failed:', e?.message)
      return c.json({
        error: 'multipart/form-data 파싱 실패',
        detail: e?.message || String(e),
      }, 400)
    }
    weekStart = (formData.get('week_start_date') as string) || undefined
    const slotRaw = parseInt((formData.get('slot') as string) || '0')
    if (slotRaw === 1 || slotRaw === 2) slot = slotRaw
    caption = (formData.get('caption') as string) || null
    linkUrl = (formData.get('link_url') as string) || null
    const file = formData.get('file') as File | null
    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !slot || !file || typeof file === 'string') {
      return c.json({
        error: 'week_start_date, slot(1|2), file 필수',
        detail: `received: week_start_date=${weekStart}, slot=${slot}, file=${file ? 'present' : 'missing'}`,
      }, 400)
    }
    const MAX_BYTES = 10 * 1024 * 1024
    if (file.size > MAX_BYTES) {
      return c.json({
        error: `파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(2)}MB)`,
        detail: `최대 ${MAX_BYTES / 1024 / 1024}MB까지 허용됩니다.`,
        size: file.size,
        filename: file.name,
      }, 413)
    }
    if (file.type && !/^image\//i.test(file.type)) {
      return c.json({
        error: '이미지 파일만 업로드 가능합니다.',
        detail: `현재 Content-Type: ${file.type}`,
      }, 400)
    }
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
    imageKey = `uploads/weekly-top/${weekStart}-slot${slot}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${ext}`
    let arrayBuffer: ArrayBuffer
    try {
      arrayBuffer = await file.arrayBuffer()
    } catch (e: any) {
      console.error('[upload top] arrayBuffer failed:', e?.message)
      return c.json({
        error: '파일 본문 읽기 실패',
        detail: e?.message || String(e),
      }, 500)
    }
    try {
      await c.env.R2.put(imageKey, arrayBuffer, {
        httpMetadata: { contentType: file.type || 'application/octet-stream' }
      })
    } catch (e: any) {
      console.error('[upload top] R2.put failed:', e?.message, 'key=', imageKey, 'size=', arrayBuffer.byteLength)
      return c.json({
        error: 'R2 업로드 실패',
        detail: e?.message || String(e),
        filename: file.name,
        size: arrayBuffer.byteLength,
        r2_key: imageKey,
      }, 500)
    }
    imageUrl = `/r2/${imageKey}`
    console.log(`[upload top] OK week=${weekStart} slot=${slot} r2_key=${imageKey} size=${arrayBuffer.byteLength}`)
  } else {
    const body = await c.req.json<any>().catch(() => ({}))
    weekStart = body.week_start_date
    slot = body.slot === 1 ? 1 : body.slot === 2 ? 2 : undefined
    imageUrl = body.image_url
    caption = body.caption || null
    linkUrl = body.link_url || null
    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !slot || !imageUrl) {
      return c.json({ error: 'week_start_date, slot(1|2), image_url 필수' }, 400)
    }
  }

  // 기존 슬롯의 R2 key (교체 시 정리)
  const existing = await c.env.DB.prepare(
    'SELECT image_key FROM weekly_top_images WHERE week_start_date = ? AND slot = ?'
  ).bind(weekStart, slot).first<{ image_key: string | null }>()
  const oldR2Key = existing?.image_key || null

  await upsertWeeklyTopImage({
    db: c.env.DB,
    weekStartDate: weekStart!,
    slot: slot!,
    imageUrl: imageUrl!,
    imageKey,
    caption, linkUrl,
    createdBy: adminId ?? null,
  })

  if (oldR2Key && oldR2Key !== imageKey) {
    await tryDeleteR2Object(c.env.R2, oldR2Key)
  }

  return c.json({ success: true, week_start_date: weekStart, slot, image_url: imageUrl })
})

/** DELETE /admin/api/weekly-images/top?week_start_date=&slot= */
admin.delete('/weekly-images/top', async (c) => {
  const weekStart = c.req.query('week_start_date')
  const slotRaw = parseInt(c.req.query('slot') || '0')
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || (slotRaw !== 1 && slotRaw !== 2)) {
    return c.json({ error: 'week_start_date, slot(1|2) 필수' }, 400)
  }
  const r2Key = await deleteWeeklyTopImage(c.env.DB, weekStart, slotRaw as 1 | 2)
  await tryDeleteR2Object(c.env.R2, r2Key)
  return c.json({ success: true, week_start_date: weekStart, slot: slotRaw, deleted_r2_key: r2Key })
})

// ════════════════════════════════════════════════════════════════════
// 운영자 검수 — 위클리 이메일 미리보기
// ════════════════════════════════════════════════════════════════════

/**
 * GET /admin/personalized-weekly/preview?week_start_date=&company_profile=&inline=1
 * — 저장된 위클리 호를 신 스타일 HTML로 미리보기
 * — inline=1 (default) : 정상 HTML 응답 (iframe 임베드용)
 *
 * NOTE: 이 라우트는 미들웨어(/admin/api/* 인증)를 받아야 하므로
 *       /admin/api 하위로 마운트되어 있음.
 */
admin.get('/personalized-weekly/preview', async (c) => {
  const weekStart = c.req.query('week_start_date')
  const profileKey = c.req.query('company_profile')
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return c.text('week_start_date(YYYY-MM-DD) 필수', 400)
  }

  const db = c.env.DB

  // 1) 저장된 위클리 호 조회 (맞춤본 우선, 없으면 일반본)
  let row: any = null
  let isPersonalized = false
  if (profileKey) {
    row = await db.prepare(`
      SELECT * FROM weekly_personalized_summaries
      WHERE week_start_date = ? AND company_profile = ?
    `).bind(weekStart, profileKey).first<any>()
    if (row) isPersonalized = true
  }
  if (!row) {
    row = await db.prepare(
      'SELECT * FROM weekly_summaries WHERE week_start_date = ?'
    ).bind(weekStart).first<any>()
  }
  if (!row) {
    return c.text(`${weekStart} ${profileKey || ''} 위클리 호가 없습니다. 먼저 생성하세요.`, 404)
  }

  // 2) 위클리 메타 (일반본의 vol_no, issue_date 등 사용)
  let generalRow: any = row
  if (isPersonalized) {
    generalRow = await db.prepare(
      'SELECT * FROM weekly_summaries WHERE week_start_date = ?'
    ).bind(weekStart).first<any>() || row
  }
  const volNo = generalRow?.vol_no || 0
  const issueDate = generalRow?.issue_date || row.issue_date || weekStart

  // 3) TOP3 조회
  const top3Rows = await db.prepare(
    'SELECT * FROM weekly_top_news WHERE week_start_date = ? ORDER BY rank ASC LIMIT 3'
  ).bind(weekStart).all<any>()
  const top3 = (top3Rows.results || []).map((r: any) => ({
    rank: r.rank, title: r.title, link: r.link, source: r.source, category: r.category,
  })) as any

  // 4) 호별 TOP 이미지 + 카테고리 대표 이미지 조회
  const topImages = await listWeeklyTopImages(db, weekStart)
  const sectionImages = await getSectionImageMap(db)

  // 5) 다음 호 안내 (간단히 +7일 KST 월요일 형식)
  const nextDate = new Date(weekStart + 'T00:00:00')
  nextDate.setDate(nextDate.getDate() + 14)  // 다음 주 월요일
  const nextIssueKo = `${nextDate.getFullYear()}년 ${nextDate.getMonth() + 1}월 ${nextDate.getDate()}일(월) 오전 7시`

  // 6) HTML 생성
  const weekEnd = (() => {
    const d = new Date(weekStart + 'T00:00:00')
    d.setDate(d.getDate() + 6)
    return d.toISOString().slice(0, 10)
  })()

  const html = renderWeeklyEmail({
    volNo,
    weekStart,
    weekEnd,
    issueDate,
    weekRangeKo: formatWeekRangeKo(weekStart, weekEnd),
    issueLabelKo: formatIssueLabelKo(weekStart),
    nextIssueKo,
    marketOneliner: row.market_oneliner || null,
    summaryMarkdown: row.content || '',
    top3,
    totalArticles: row.article_count || 0,
    companyContents: [],
    siteUrl: new URL(c.req.url).origin,
    unsubscribeToken: 'preview',
    logoUrl: null,
    senderName: isPersonalized ? `모투스 위클리 (${profileKey} 맞춤본)` : '모투스 위클리',
    sectionImages,
    topImages: topImages.map(t => ({
      slot: t.slot,
      image_url: t.image_url,
      caption: t.caption,
      link_url: t.link_url,
    })),
  } as any)

  return c.html(html)
})

/**
 * GET /admin/api/personalized-weekly/review-detail?week_start_date=&company_profile=
 * — 검수 화면용: 위클리 호 메타 + 검증 결과 + TOP3 정보 한 번에 조회
 */
admin.get('/personalized-weekly/review-detail', async (c) => {
  const weekStart = c.req.query('week_start_date')
  const profileKey = c.req.query('company_profile')
  if (!weekStart || !profileKey) {
    return c.json({ error: 'week_start_date, company_profile 필수' }, 400)
  }

  const row = await c.env.DB.prepare(`
    SELECT * FROM weekly_personalized_summaries
    WHERE week_start_date = ? AND company_profile = ?
  `).bind(weekStart, profileKey).first<any>()
  if (!row) return c.json({ error: '해당 호 없음' }, 404)

  const verification = safeJsonObject(row.verification_json || '{}') || {}
  const profile = getCompanyProfile(profileKey)

  return c.json({
    week_start_date: weekStart,
    company_profile: profileKey,
    profile_name: profile?.displayName || profileKey,
    status: row.status,
    operator_review_status: row.operator_review_status,
    operator_review_notes: row.operator_review_notes,
    market_oneliner: row.market_oneliner,
    article_count: row.article_count,
    content_length: (row.content || '').length,
    verification,
    issue_date: row.issue_date,
    updated_at: row.updated_at,
  })
})

export default admin
