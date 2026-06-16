// 공개 API 라우트 (구독, 클릭 추적 등)

import { Hono } from 'hono'
import type { Bindings, AppVariables } from '../lib/types'
import { addSubscriber, unsubscribeByToken } from '../lib/subscriber'
import { getContent, getActiveContents, incrementView, recordClick } from '../lib/content'
import { getNewsByDate, getRecentNews, getNewsCounts, searchNews, getAvailableSources } from '../lib/news'
import { getSummaryByDate, getRecentSummaries, getRecentWeeklySummaries } from '../lib/ai'
import { getWeeklyTagsBulk } from '../lib/weeklyTags'
import { getSectionImageMap } from '../lib/weeklyImages'
import { formatIssueLabelKo, formatWeekRangeKo } from '../lib/utils'
import { todayKST } from '../lib/utils'

const api = new Hono<{ Bindings: Bindings; Variables: AppVariables }>()

// 구독 신청
api.post('/subscribe', async (c) => {
  const body = await c.req.json<{ email?: string; name?: string }>().catch(() => ({}))
  if (!body.email) return c.json({ error: '이메일을 입력해주세요.' }, 400)
  const r = await addSubscriber(c.env.DB, body.email.trim().toLowerCase(), body.name?.trim())
  if ('error' in r) return c.json({ error: r.error }, 400)
  return c.json({ success: true, id: r.id })
})

// 구독 해지 (POST API)
api.post('/unsubscribe', async (c) => {
  const body = await c.req.json<{ token?: string }>().catch(() => ({}))
  if (!body.token) return c.json({ error: '토큰이 필요합니다.' }, 400)
  const ok = await unsubscribeByToken(c.env.DB, body.token)
  return c.json({ success: ok })
})

// 오늘의 뉴스/요약
api.get('/today', async (c) => {
  const date = todayKST()
  const news = await getRecentNews(c.env.DB, 100)
  const counts = await getNewsCounts(c.env.DB, date)
  const summary = await getSummaryByDate(c.env.DB, date)
  const contents = await getActiveContents(c.env.DB, { limit: 6 })
  const sectionImages = await getSectionImageMap(c.env.DB).catch(() => ({}))
  return c.json({
    date,
    summary: summary?.content || null,
    articleCount: summary?.article_count || news.length,
    counts,
    news,
    contents,
    sectionImages,  // { urban: '/r2/...', sale: '/r2/...', ... }
  })
})

// 특정 날짜 뉴스/요약
api.get('/archive/:date', async (c) => {
  const date = c.req.param('date')
  const news = await getNewsByDate(c.env.DB, date)
  const summary = await getSummaryByDate(c.env.DB, date)
  const counts = await getNewsCounts(c.env.DB, date)
  return c.json({ date, summary: summary?.content || null, articleCount: summary?.article_count || news.length, counts, news })
})

// 최근 요약 목록 (일간 — 레거시 호환용)
api.get('/summaries', async (c) => {
  const limit = parseInt(c.req.query('limit') || '14')
  const items = await getRecentSummaries(c.env.DB, limit)
  return c.json({ items })
})

// 최근 위클리 호 목록 (아카이브 카드용)
//   - 각 호의 week_start_date, vol_no, issue_date, market_oneliner, article_count
//   - 태그 (weekly_summary_tags)
//   - 사람이 읽기 좋은 라벨(issueLabel, weekRange)도 함께 제공
api.get('/weekly-summaries', async (c) => {
  const limit = parseInt(c.req.query('limit') || '12')
  const rows = await getRecentWeeklySummaries(c.env.DB, limit)
  if (rows.length === 0) {
    return c.json({ items: [] })
  }

  const weekStarts = rows.map((r) => r.week_start_date)
  const tagsMap = await getWeeklyTagsBulk(c.env.DB, weekStarts)

  const items = rows.map((r) => ({
    week_start_date: r.week_start_date,
    week_end_date: r.week_end_date,
    vol_no: r.vol_no,
    issue_date: r.issue_date,
    market_oneliner: r.market_oneliner || null,
    article_count: r.article_count || 0,
    status: r.status,
    issue_label: formatIssueLabelKo(r.issue_date),
    week_range: formatWeekRangeKo(r.week_start_date, r.week_end_date),
    tags: tagsMap.get(r.week_start_date) || [],
  }))

  return c.json({ items })
})

// 활성 자사 콘텐츠
api.get('/contents', async (c) => {
  const items = await getActiveContents(c.env.DB, { limit: 12 })
  return c.json({ items })
})

// 콘텐츠 상세 (조회수 증가)
api.get('/content/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const item = await getContent(c.env.DB, id)
  if (!item || item.status !== 'published') return c.json({ error: 'Not found' }, 404)
  await incrementView(c.env.DB, id)
  return c.json({ item })
})

// 콘텐츠 클릭 추적
api.post('/content/:id/click', async (c) => {
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json<{ source?: string }>().catch(() => ({}))
  const source = body.source === 'email' ? 'email' : 'web'
  await recordClick(c.env.DB, id, source)
  return c.json({ success: true })
})

// 뉴스 검색
api.get('/news/search', async (c) => {
  const q = c.req.query('q')
  const group = c.req.query('group')
  const category = c.req.query('category')
  const source = c.req.query('source')
  const start = c.req.query('start')
  const end = c.req.query('end')
  const sort = (c.req.query('sort') === 'relevance' ? 'relevance' : 'recent') as 'recent' | 'relevance'
  const page = parseInt(c.req.query('page') || '1')
  const pageSize = parseInt(c.req.query('pageSize') || '20')
  const result = await searchNews(c.env.DB, {
    q, group, category, source, startDate: start, endDate: end, sort, page, pageSize
  })
  return c.json(result)
})

// 검색 필터용 언론사 목록
api.get('/news-sources', async (c) => {
  const items = await getAvailableSources(c.env.DB, 100)
  return c.json({ items })
})

export default api
