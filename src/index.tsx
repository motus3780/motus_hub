import { Hono } from 'hono'
import type { Bindings, AppVariables } from './lib/types'
import api from './routes/api'
import adminApi from './routes/admin'
import { isSetupComplete, getSetting, SETTING_KEYS } from './lib/settings'
import { renderMainPage, renderArchivePage, renderContentDetailPage, renderUnsubscribePage, renderSearchPage, renderNewsListPage } from './templates/pages'
import {
  renderSetupPage, renderLoginPage, renderDashboardPage,
  renderContentsPage, renderContentEditPage, renderSubscribersPage,
  renderEmailLogsPage, renderSettingsPage,
  renderAdminNewsSearchPage, renderMediaMappingPage,
  renderWeeklyEventsPage,
  renderWeeklyImagesPage, renderPersonalizedReviewPage,
} from './templates/adminPages'
import { getNewsByDate } from './lib/news'
import { getSummaryByDate, getLatestWeeklySummary } from './lib/ai'
import { getNewsCounts } from './lib/news'
import { getContent, recordClick } from './lib/content'
import { unsubscribeByToken } from './lib/subscriber'
import { getSessionAdmin } from './lib/auth'
import { getCookie } from 'hono/cookie'
import { runDailyJob } from './lib/dailyJob'
import { todayKST, nowKST } from './lib/utils'
import { runScheduledByTime, loadAutoJobConfig } from './lib/autoJob'

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>()

// === 셋업 가드 ===
app.use('*', async (c, next) => {
  // 설정/로그인/정적 파일/admin api는 통과
  const p = c.req.path
  if (
    p.startsWith('/static') ||
    p.startsWith('/r2/') ||
    p.startsWith('/admin/api/setup') ||
    p === '/admin/setup' ||
    p === '/admin/api/setup-status'
  ) {
    return next()
  }
  // 셋업 미완료면 셋업 페이지로
  const setup = await isSetupComplete(c.env.DB).catch(() => false)
  if (!setup) {
    if (p.startsWith('/admin/api')) return c.json({ error: '셋업이 필요합니다.' }, 503)
    return c.redirect('/admin/setup')
  }
  await next()
})

// === API 라우트 ===
app.route('/api', api)
app.route('/admin/api', adminApi)

// 현재 요청의 관리자 세션을 안전하게 확인 (실패 시 null 반환)
async function getCurrentAdmin(c: any): Promise<{ id: number; username: string } | null> {
  try {
    const token = getCookie(c, 'admin_session')
    if (!token) return null
    return await getSessionAdmin(c.env.DB, token)
  } catch {
    return null
  }
}

// === 메인 페이지 (이번 주 호 중심) ===
// 최신 위클리 호(status: ready/sent)가 있으면 props로 전달, 없으면 베타 모드 폴백 노출
// isAdmin 플래그도 함께 전달하여 '🔄 지금 새로 수집하기' 버튼 노출 제어
app.get('/', async (c) => {
  const logoUrl = await getSetting(c.env.DB, SETTING_KEYS.COMPANY_LOGO_URL)
  const senderName = (await getSetting(c.env.DB, SETTING_KEYS.SENDER_NAME)) || '모투스 위클리'
  const latestWeekly = await getLatestWeeklySummary(c.env.DB).catch((e) => {
    console.error('[Main] getLatestWeeklySummary 실패:', e?.message || e)
    return null
  })
  const admin = await getCurrentAdmin(c)
  return c.html(renderMainPage({ logoUrl, senderName, latestWeekly, isAdmin: !!admin }))
})

// === 메인 수동 수집 (관리자 전용) ===
// 이전에는 누구나 호출 가능했으나, 보안 강화를 위해 관리자 세션 필수.
// (Cloudflare Pages cron이 별도로 매일 06:30 KST에 자동 수집을 수행하므로 일반 사용자가 트리거할 필요 없음)
app.post('/api/collect', async (c) => {
  const admin = await getCurrentAdmin(c)
  if (!admin) {
    return c.json({ error: '관리자만 사용할 수 있습니다.' }, 401)
  }
  try {
    const r = await runDailyJob(c.env.DB, { skipSend: true })
    return c.json(r)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// === 뉴스 검색 페이지 ===
app.get('/search', async (c) => {
  const logoUrl = await getSetting(c.env.DB, SETTING_KEYS.COMPANY_LOGO_URL)
  const senderName = (await getSetting(c.env.DB, SETTING_KEYS.SENDER_NAME)) || '모투스 위클리'
  return c.html(renderSearchPage({ logoUrl, senderName }))
})

// === 특정 날짜 전체 뉴스 페이지 (이메일의 "전체 뉴스 보기" 링크 대상) ===
app.get('/news/:date', async (c) => {
  const date = c.req.param('date')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.notFound()
  const news = await getNewsByDate(c.env.DB, date)
  const counts = await getNewsCounts(c.env.DB, date)
  return c.html(renderNewsListPage({ date, news, counts }))
})

// === 아카이브 ===
app.get('/archive/:date', async (c) => {
  const date = c.req.param('date')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.notFound()
  const summary = await getSummaryByDate(c.env.DB, date)
  const news = await getNewsByDate(c.env.DB, date)
  const counts = await getNewsCounts(c.env.DB, date)
  return c.html(renderArchivePage({
    date,
    summary: summary?.content || null,
    articleCount: summary?.article_count || news.length,
    news,
    counts
  }))
})

// === 콘텐츠 상세 ===
app.get('/content/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const item = await getContent(c.env.DB, id)
  if (!item || item.status !== 'published') return c.html('<h1>콘텐츠를 찾을 수 없습니다.</h1>', 404)
  await c.env.DB.prepare('UPDATE company_contents SET view_count = view_count + 1 WHERE id = ?').bind(id).run()
  return c.html(renderContentDetailPage(item))
})

// === 콘텐츠 클릭 → 외부 링크 리다이렉트 ===
app.get('/c/:id/click', async (c) => {
  const id = parseInt(c.req.param('id'))
  const source = (c.req.query('source') === 'email' ? 'email' : 'web') as 'email' | 'web'
  const redirect = c.req.query('redirect')
  const item = await getContent(c.env.DB, id)
  if (!item) return c.notFound()
  await recordClick(c.env.DB, id, source)
  const url = redirect || item.external_link || `/content/${id}`
  return c.redirect(url)
})

// === 구독 해지 페이지 ===
app.get('/unsubscribe', async (c) => {
  const token = c.req.query('token') || ''
  if (!token) return c.html(renderUnsubscribePage({ success: false, message: '잘못된 접근입니다.' }))
  const ok = await unsubscribeByToken(c.env.DB, token)
  if (ok) {
    return c.html(renderUnsubscribePage({ success: true, message: '앞으로 더 이상 메일이 발송되지 않습니다. 언제든지 다시 구독하실 수 있습니다.' }))
  }
  return c.html(renderUnsubscribePage({ success: false, message: '이미 해지되었거나 유효하지 않은 토큰입니다.' }))
})

// === R2 이미지 서빙 ===
app.get('/r2/*', async (c) => {
  if (!c.env.R2) {
    return c.text('R2 storage is not configured. Bind R2 bucket in Cloudflare dashboard.', 503)
  }
  const key = c.req.path.replace(/^\/r2\//, '')
  const obj = await c.env.R2.get(key)
  if (!obj) return c.notFound()
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'cache-control': 'public, max-age=86400'
    }
  })
})

// === 관리자 페이지들 ===
app.get('/admin', (c) => c.redirect('/admin/dashboard'))

app.get('/admin/setup', async (c) => {
  const completed = await isSetupComplete(c.env.DB)
  if (completed) return c.redirect('/admin/login')
  return c.html(renderSetupPage())
})

app.get('/admin/login', async (c) => {
  // 이미 로그인되어 있으면 대시보드로
  const token = getCookie(c, 'admin_session')
  if (token) {
    const a = await getSessionAdmin(c.env.DB, token)
    if (a) return c.redirect('/admin/dashboard')
  }
  return c.html(renderLoginPage())
})

// 관리자 보호 페이지 미들웨어
async function requireAdminPage(c: any, next: () => Promise<void>) {
  const token = getCookie(c, 'admin_session')
  if (!token) return c.redirect('/admin/login')
  const a = await getSessionAdmin(c.env.DB, token)
  if (!a) return c.redirect('/admin/login')
  await next()
}

app.get('/admin/dashboard', requireAdminPage, (c) => c.html(renderDashboardPage()))
app.get('/admin/contents', requireAdminPage, (c) => c.html(renderContentsPage()))
app.get('/admin/contents/new', requireAdminPage, (c) => c.html(renderContentEditPage()))
app.get('/admin/contents/:id/edit', requireAdminPage, (c) => {
  const id = parseInt(c.req.param('id'))
  return c.html(renderContentEditPage(id))
})
app.get('/admin/subscribers', requireAdminPage, (c) => c.html(renderSubscribersPage()))
app.get('/admin/email-logs', requireAdminPage, (c) => c.html(renderEmailLogsPage()))
app.get('/admin/settings', requireAdminPage, (c) => c.html(renderSettingsPage()))
app.get('/admin/news-search', requireAdminPage, (c) => c.html(renderAdminNewsSearchPage()))
app.get('/admin/media-mapping', requireAdminPage, (c) => c.html(renderMediaMappingPage()))
app.get('/admin/weekly-events', requireAdminPage, (c) => c.html(renderWeeklyEventsPage()))
app.get('/admin/weekly-images', requireAdminPage, (c) => c.html(renderWeeklyImagesPage()))
app.get('/admin/personalized-review', requireAdminPage, (c) => c.html(renderPersonalizedReviewPage()))

// === Cron 트리거: 자동 수집·요약 / 자동 위클리 발송 ===
// wrangler.jsonc triggers.crons:
//   - "30 21 * * *"  UTC 21:30 = KST 매일 06:30  (일간 뉴스 수집·요약 → 사이트 일간 보기 유지)
//   - "0 22 * * 0"   UTC 일 22:00 = KST 월 07:00 (위클리 이메일 발송)
// 일간 발송 cron("30 22 * * *")은 위클리 전환에 따라 폐지되었습니다.
// 관리자 설정으로 시각 변경 가능 → runScheduledByTime이 KST 요일/시각과 매칭하여 적절한 작업 실행
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    const k = nowKST()
    const hh = String(k.getUTCHours()).padStart(2, '0')
    const mm = String(k.getUTCMinutes()).padStart(2, '0')
    const cronExpr = event.cron || 'n/a'
    console.log(`[Cron] 발화 - KST ${hh}:${mm} UTC=${new Date().toISOString()} (cron: ${cronExpr})`)

    // waitUntil로 백그라운드에서 실행 - Cron 핸들러 응답은 즉시 반환되어
    // Cloudflare가 동일 작업을 재실행하는 일이 없도록 보호한다.
    ctx.waitUntil((async () => {
      try {
        const r = await runScheduledByTime(env.DB, { RESEND_API_KEY: env.RESEND_API_KEY })
        console.log(`[Cron ${cronExpr}] 실행 결과: ${r.executed}`, r.log ? `status=${r.log.status}` : '')
      } catch (e: any) {
        console.error(`[Cron ${cronExpr}] 실패:`, e?.message || e)
      }
    })())
  }
}
