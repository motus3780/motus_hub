// 네이버 뉴스 검색 API 연동 + 수집

import {
  CATEGORIES, URBAN_RENEWAL_EXTRA_QUERIES, AD_MEDIA_EXTRA_QUERIES,
  CATEGORY_GROUP_MAP, AD_SPAM_PATTERNS,
  type Category, type CategoryGroup, type NewsItem
} from './types'
import { cleanText, todayKST } from './utils'
import { getSetting, SETTING_KEYS } from './settings'
import { resolveMediaName } from './media'
import { checkPolitics } from './politicsFilter'

interface NaverNewsItem {
  title: string
  originallink: string
  link: string
  description: string
  pubDate: string
}

interface NaverResponse {
  items: NaverNewsItem[]
  total: number
}

async function fetchNaverNews(clientId: string, clientSecret: string, query: string, display: number = 20): Promise<NaverNewsItem[]> {
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=${display}&sort=date`
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret
    }
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Naver API ${res.status}: ${text}`)
  }
  const data = await res.json() as NaverResponse
  return data.items || []
}

export function extractDomain(originallink: string, link: string): string {
  try {
    const url = new URL(originallink || link)
    return url.hostname.replace(/^www\./, '')
  } catch {
    return '-'
  }
}

/**
 * 카테고리 그룹 활성화 여부 (settings 테이블에 JSON으로 저장)
 *  key: collect_groups_enabled = '{"부동산":true,"도시정비":true,"광고/매체":true,"AI":true}'
 *  미설정 시: 모든 그룹 활성화로 간주.
 */
export async function getEnabledCategoryGroups(db: D1Database): Promise<Record<CategoryGroup, boolean>> {
  const raw = await getSetting(db, 'collect_groups_enabled').catch(() => null)
  const def: Record<CategoryGroup, boolean> = {
    '부동산': true, '도시정비': true, '광고/매체': true, 'AI': true, '기타': true
  }
  if (!raw) return def
  try {
    const parsed = JSON.parse(raw)
    return { ...def, ...parsed }
  } catch {
    return def
  }
}

export async function setEnabledCategoryGroups(
  db: D1Database,
  enabled: Partial<Record<CategoryGroup, boolean>>
): Promise<void> {
  const { setSetting } = await import('./settings')
  const cur = await getEnabledCategoryGroups(db)
  const merged = { ...cur, ...enabled }
  await setSetting(db, 'collect_groups_enabled', JSON.stringify(merged))
}

export interface CollectResult {
  collected: number
  categories: Record<string, number>
  excludedPolitics: number    // 정치 필터로 격리된 건수
  excludedAdSpam: number      // 광고/홍보 spam 으로 제거된 건수
}

export async function collectNewsForToday(db: D1Database): Promise<CollectResult> {
  const clientId = await getSetting(db, SETTING_KEYS.NAVER_CLIENT_ID)
  const clientSecret = await getSetting(db, SETTING_KEYS.NAVER_CLIENT_SECRET)
  if (!clientId || !clientSecret) {
    throw new Error('네이버 API 키가 설정되지 않았습니다.')
  }

  const today = todayKST()
  const stats: Record<string, number> = {}
  let totalCollected = 0
  // 정치/광고 격리 누적 카운터 (insertNewsItems에서 ref로 증가)
  const counters = { excludedPolitics: 0, excludedAdSpam: 0 }

  // 카테고리 그룹별 활성화 토글
  const groupsEnabled = await getEnabledCategoryGroups(db)

  // 메인 카테고리별 수집
  for (const cat of CATEGORIES) {
    const group = CATEGORY_GROUP_MAP[cat.key] || '기타'
    if (!groupsEnabled[group]) {
      stats[cat.key] = stats[cat.key] || 0
      continue
    }
    try {
      const items = await fetchNaverNews(clientId, clientSecret, cat.query, 20)
      const inserted = await insertNewsItems(db, items, cat.key, today, counters)
      stats[cat.key] = (stats[cat.key] || 0) + inserted
      totalCollected += inserted
    } catch (e: any) {
      console.error(`[${cat.key}] 수집 실패:`, e.message)
      stats[cat.key] = stats[cat.key] || 0
    }
  }

  // 도시정비: 추가 키워드로 보강 수집
  if (groupsEnabled['도시정비']) {
    for (const extraQuery of URBAN_RENEWAL_EXTRA_QUERIES) {
      try {
        const items = await fetchNaverNews(clientId, clientSecret, extraQuery, 10)
        const inserted = await insertNewsItems(db, items, '도시정비', today, counters)
        stats['도시정비'] = (stats['도시정비'] || 0) + inserted
        totalCollected += inserted
      } catch (e: any) {
        console.error(`[도시정비/${extraQuery}] 수집 실패:`, e.message)
      }
    }
  }

  // 광고/매체: 카테고리별 추가 키워드로 보강 수집
  if (groupsEnabled['광고/매체']) {
    const adCats: Category[] = ['옥외광고', '디지털광고', '광고산업', '미디어', '광고규제']
    for (const cat of adCats) {
      const extras = AD_MEDIA_EXTRA_QUERIES[cat] || []
      for (const eq of extras) {
        try {
          const items = await fetchNaverNews(clientId, clientSecret, eq, 10)
          const inserted = await insertNewsItems(db, items, cat, today, counters)
          stats[cat] = (stats[cat] || 0) + inserted
          totalCollected += inserted
        } catch (e: any) {
          console.error(`[${cat}/${eq}] 수집 실패:`, e.message)
        }
      }
    }
  }

  console.log(`[Collect] ${today} 완료 — 저장 ${totalCollected}건, 정치 격리 ${counters.excludedPolitics}건, 광고/홍보 spam ${counters.excludedAdSpam}건`)

  return {
    collected: totalCollected,
    categories: stats,
    excludedPolitics: counters.excludedPolitics,
    excludedAdSpam: counters.excludedAdSpam,
  }
}

/** 광고성/홍보성 콘텐츠 필터링 (제목/본문에 자기참조 패턴 포함 시 제외) */
function isAdSpam(title: string, description: string): boolean {
  const text = `${title} ${description}`
  for (const pat of AD_SPAM_PATTERNS) {
    if (pat.test(text)) return true
  }
  return false
}

async function insertNewsItems(
  db: D1Database,
  items: NaverNewsItem[],
  category: Category,
  today: string,
  counters?: { excludedPolitics: number; excludedAdSpam: number }
): Promise<number> {
  let inserted = 0
  // 매핑 테이블 1회 로드
  const mappings = await loadMediaMappingsCached(db)

  for (const it of items) {
    const title = cleanText(it.title)
    const description = cleanText(it.description)
    const link = it.originallink || it.link

    // (1) 광고성/홍보성 콘텐츠 필터 — 자기참조 패턴 제거
    if (isAdSpam(title, description)) {
      if (counters) counters.excludedAdSpam++
      continue
    }

    // (2) 정치 콘텐츠 필터 — 정치 키워드/정치인/URL 패턴 매칭 시 excluded_articles로 격리
    const polCheck = checkPolitics({ title, description, link })
    if (polCheck.isPolitical) {
      if (counters) counters.excludedPolitics++
      try {
        const domain = extractDomain(it.originallink, it.link)
        const source = resolveMediaName(domain, mappings)
        const pubDate = it.pubDate ? new Date(it.pubDate).toISOString() : null
        await db.prepare(`
          INSERT INTO excluded_articles
            (title, description, link, source, pub_date, category, collection_date,
             excluded_reason, matched_keywords, matched_politicians, matched_url_patterns)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(link, collection_date) DO NOTHING
        `).bind(
          title, description, link, source, pubDate, category, today,
          polCheck.reasons.join(' | '),
          JSON.stringify(polCheck.matched.keywords),
          JSON.stringify(polCheck.matched.politicians),
          JSON.stringify(polCheck.matched.urlPatterns),
        ).run()
      } catch (e) {
        // 격리 INSERT 실패는 운영상 치명적이지 않으므로 swallow
      }
      continue
    }

    // (3) 정상 기사 → news 테이블에 저장
    const domain = extractDomain(it.originallink, it.link)
    const source = resolveMediaName(domain, mappings)
    const pubDate = new Date(it.pubDate).toISOString()

    try {
      const result = await db.prepare(`
        INSERT INTO news (title, description, link, source, pub_date, category, collection_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(link) DO NOTHING
      `).bind(title, description, link, source, pubDate, category, today).run()
      if (result.meta.changes > 0) inserted++
    } catch (e) {
      // 중복 등의 이유로 실패 시 무시
    }
  }
  return inserted
}

// 매핑 테이블 캐싱 (수집 1회 동안만 사용)
let _mediaMappingsCache: Record<string, string> | null = null
let _mediaMappingsCacheAt = 0
async function loadMediaMappingsCached(db: D1Database): Promise<Record<string, string>> {
  const now = Date.now()
  if (_mediaMappingsCache && (now - _mediaMappingsCacheAt) < 60_000) {
    return _mediaMappingsCache
  }
  const { loadMediaMappings } = await import('./media')
  _mediaMappingsCache = await loadMediaMappings(db)
  _mediaMappingsCacheAt = now
  return _mediaMappingsCache
}

export async function getNewsByDate(db: D1Database, date: string, category?: Category): Promise<NewsItem[]> {
  let q = 'SELECT * FROM news WHERE collection_date = ?'
  const binds: any[] = [date]
  if (category) {
    q += ' AND category = ?'
    binds.push(category)
  }
  q += ' ORDER BY pub_date DESC'
  const result = await db.prepare(q).bind(...binds).all<NewsItem>()
  return result.results
}

export async function getRecentNews(db: D1Database, limit: number = 100): Promise<NewsItem[]> {
  const result = await db.prepare(
    'SELECT * FROM news WHERE collection_date = ? ORDER BY pub_date DESC LIMIT ?'
  ).bind(todayKST(), limit).all<NewsItem>()
  return result.results
}

export async function getNewsCounts(db: D1Database, date: string): Promise<Record<string, number>> {
  const result = await db.prepare(
    'SELECT category, COUNT(*) as cnt FROM news WHERE collection_date = ? GROUP BY category'
  ).bind(date).all<{ category: string; cnt: number }>()
  const out: Record<string, number> = {}
  for (const r of result.results) out[r.category] = r.cnt
  return out
}

/**
 * 카테고리 균형 배분 + 최신순으로 TOP N 뉴스 선정
 * 기본 배분 (총 15건): 부동산 4 · 도시정비 4 · 광고/매체 3 · AI 2 · 기타 2
 * 부족한 카테고리는 다른 카테고리에서 채움
 */
export function pickBalancedTopNews(news: NewsItem[], total: number = 15): NewsItem[] {
  const quotas: Record<string, number> = {
    '부동산': 4,
    '도시정비': 4,
    '광고/매체': 3,
    'AI': 2,
    '기타': 2
  }
  // 카테고리별로 그룹화 + pub_date 내림차순 정렬
  const byGroup: Record<string, NewsItem[]> = {
    '부동산': [], '도시정비': [], '광고/매체': [], 'AI': [], '기타': []
  }
  const sorted = [...news].sort((a, b) => (b.pub_date || '').localeCompare(a.pub_date || ''))
  for (const n of sorted) {
    const grp = CATEGORY_GROUP_MAP[n.category] || '기타'
    byGroup[grp].push(n)
  }

  // 1차: 쿼터만큼 채움
  const picked: NewsItem[] = []
  const usedIds = new Set<number | string>()
  for (const grp of Object.keys(quotas)) {
    const items = byGroup[grp].slice(0, quotas[grp])
    for (const it of items) {
      picked.push(it)
      usedIds.add(it.id ?? it.link)
    }
  }

  // 2차: 부족분 보충 (전체 최신순에서 미사용 항목)
  if (picked.length < total) {
    for (const n of sorted) {
      if (picked.length >= total) break
      const id = n.id ?? n.link
      if (!usedIds.has(id)) {
        picked.push(n)
        usedIds.add(id)
      }
    }
  }

  // 3차: 최신순 재정렬
  return picked
    .sort((a, b) => (b.pub_date || '').localeCompare(a.pub_date || ''))
    .slice(0, total)
}

// ============ 뉴스 검색 ============

export interface SearchOptions {
  q?: string
  group?: string  // 부동산 | 도시정비 | AI | 광고/매체 | 기타 | 전체
  category?: string  // 특정 세부 카테고리 (옥외광고/디지털광고 등) 직접 필터
  source?: string
  startDate?: string  // YYYY-MM-DD
  endDate?: string
  sort?: 'recent' | 'relevance'
  page?: number
  pageSize?: number
}

export interface SearchResult {
  items: NewsItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// 검색 결과 캐시 (5분)
const _searchCache = new Map<string, { result: SearchResult; expiresAt: number }>()
const SEARCH_CACHE_TTL = 5 * 60 * 1000

function buildSearchCacheKey(opts: SearchOptions): string {
  return JSON.stringify({
    q: opts.q || '',
    g: opts.group || '',
    c: opts.category || '',
    s: opts.source || '',
    sd: opts.startDate || '',
    ed: opts.endDate || '',
    sr: opts.sort || 'recent',
    p: opts.page || 1,
    ps: opts.pageSize || 20
  })
}

export async function searchNews(db: D1Database, opts: SearchOptions): Promise<SearchResult> {
  const cacheKey = buildSearchCacheKey(opts)
  const cached = _searchCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result
  }

  const page = Math.max(1, opts.page || 1)
  const pageSize = Math.min(50, Math.max(1, opts.pageSize || 20))
  const offset = (page - 1) * pageSize

  const where: string[] = []
  const binds: any[] = []

  // 키워드 검색 (제목 + 본문)
  if (opts.q && opts.q.trim()) {
    const kw = `%${opts.q.trim()}%`
    where.push('(title LIKE ? OR description LIKE ?)')
    binds.push(kw, kw)
  }

  // 세부 카테고리 직접 필터 (그룹보다 우선)
  if (opts.category && opts.category.trim() && opts.category !== '전체') {
    where.push('category = ?')
    binds.push(opts.category.trim())
  } else if (opts.group && opts.group !== '전체') {
    // 그룹 필터 → 카테고리 IN 변환
    const cats = Object.entries(CATEGORY_GROUP_MAP)
      .filter(([_, g]) => g === opts.group)
      .map(([c]) => c)
    if (cats.length > 0) {
      const placeholders = cats.map(() => '?').join(',')
      where.push(`category IN (${placeholders})`)
      binds.push(...cats)
    } else if (opts.group === '기타') {
      // 기타: 매핑되지 않은 카테고리
      const knownCats = Object.keys(CATEGORY_GROUP_MAP)
      const placeholders = knownCats.map(() => '?').join(',')
      where.push(`category NOT IN (${placeholders})`)
      binds.push(...knownCats)
    }
  }

  // 언론사 필터
  if (opts.source && opts.source.trim()) {
    where.push('source = ?')
    binds.push(opts.source.trim())
  }

  // 기간 필터
  if (opts.startDate) {
    where.push('collection_date >= ?')
    binds.push(opts.startDate)
  }
  if (opts.endDate) {
    where.push('collection_date <= ?')
    binds.push(opts.endDate)
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  // 카운트
  const countRow = await db.prepare(`SELECT COUNT(*) as cnt FROM news ${whereSql}`)
    .bind(...binds).first<{ cnt: number }>()
  const total = countRow?.cnt || 0

  // 정렬
  let orderBy = 'pub_date DESC'
  if (opts.sort === 'relevance' && opts.q) {
    // 간이 관련도: 제목에 키워드가 있으면 우선, 그 다음 최신순
    orderBy = `CASE WHEN title LIKE ? THEN 0 ELSE 1 END, pub_date DESC`
    binds.push(`%${opts.q.trim()}%`)
  }

  const itemsResult = await db.prepare(
    `SELECT * FROM news ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  ).bind(...binds, pageSize, offset).all<NewsItem>()

  const result: SearchResult = {
    items: itemsResult.results,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  }

  // 캐시 저장 + LRU 정리
  if (_searchCache.size > 50) {
    const firstKey = _searchCache.keys().next().value
    if (firstKey) _searchCache.delete(firstKey)
  }
  _searchCache.set(cacheKey, { result, expiresAt: Date.now() + SEARCH_CACHE_TTL })

  return result
}

/**
 * 검색에서 사용 가능한 언론사 목록 (수집된 뉴스에 등장한 source 중 빈도 상위)
 */
export async function getAvailableSources(db: D1Database, limit: number = 50): Promise<string[]> {
  const r = await db.prepare(`
    SELECT source, COUNT(*) as cnt FROM news
    WHERE source IS NOT NULL AND source != '' AND source != '-'
    GROUP BY source
    ORDER BY cnt DESC
    LIMIT ?
  `).bind(limit).all<{ source: string; cnt: number }>()
  return r.results.map(x => x.source)
}

// ════════════════════════════════════════════════════════════════════
// 위클리(Weekly) 뉴스 조회 / 선별
// ════════════════════════════════════════════════════════════════════

/**
 * 주간 범위 내 뉴스 조회
 * weekStart, weekEnd: YYYY-MM-DD (KST, 양끝 포함)
 * 정렬: pub_date DESC (최신순)
 */
export async function getNewsByWeek(
  db: D1Database,
  weekStart: string,
  weekEnd: string,
  opts?: { category?: Category; group?: CategoryGroup; limit?: number }
): Promise<NewsItem[]> {
  let q = 'SELECT * FROM news WHERE collection_date >= ? AND collection_date <= ?'
  const binds: any[] = [weekStart, weekEnd]

  if (opts?.category) {
    q += ' AND category = ?'
    binds.push(opts.category)
  } else if (opts?.group) {
    const cats = Object.entries(CATEGORY_GROUP_MAP)
      .filter(([_, g]) => g === opts.group)
      .map(([c]) => c)
    if (cats.length > 0) {
      q += ` AND category IN (${cats.map(() => '?').join(',')})`
      binds.push(...cats)
    }
  }

  q += ' ORDER BY pub_date DESC'
  if (opts?.limit && opts.limit > 0) {
    q += ' LIMIT ?'
    binds.push(opts.limit)
  }

  const result = await db.prepare(q).bind(...binds).all<NewsItem>()
  return result.results
}

/**
 * 주간 범위 카테고리/그룹별 집계
 * 반환: { byCategory, byGroup, total }
 */
export async function getWeekNewsCounts(
  db: D1Database,
  weekStart: string,
  weekEnd: string
): Promise<{ byCategory: Record<string, number>; byGroup: Record<CategoryGroup, number>; total: number }> {
  const result = await db.prepare(`
    SELECT category, COUNT(*) as cnt FROM news
    WHERE collection_date >= ? AND collection_date <= ?
    GROUP BY category
  `).bind(weekStart, weekEnd).all<{ category: string; cnt: number }>()

  const byCategory: Record<string, number> = {}
  const byGroup: Record<CategoryGroup, number> = {
    '부동산': 0, '도시정비': 0, '광고/매체': 0, 'AI': 0, '기타': 0
  }
  let total = 0
  for (const r of result.results) {
    byCategory[r.category] = r.cnt
    const grp = CATEGORY_GROUP_MAP[r.category as Category] || '기타'
    byGroup[grp] += r.cnt
    total += r.cnt
  }
  return { byCategory, byGroup, total }
}

/**
 * 주간 TOP 3 핵심 이슈 선정
 *
 * 알고리즘 (그룹 다양성 + 가중치 + 최신성):
 *   1) 각 뉴스에 점수 부여
 *      - 그룹 기본 가중치: 부동산 1.0 / 도시정비 1.0 / 광고/매체 0.85 / AI 0.7 / 기타 0.5
 *      - 동일 source/주에 중복 등장하는 이슈 보너스 (+0.3, 최대 1회) — "주간 화제성"
 *      - 최신성 보너스: weekEnd 가까운 날일수록 가산 (0 ~ +0.2)
 *   2) 점수 내림차순 정렬
 *   3) 한 그룹이 TOP 3 중 2개를 초과하지 못하도록 다양성 강제
 *      - 부동산/도시정비는 묶어서 "주거" 광역그룹 취급 (한 분야 편중 방지)
 *
 * 결과: 정확히 3개 (뉴스가 부족하면 가용한 만큼만)
 */
export interface WeeklyTopPick {
  news: NewsItem
  rank: number       // 1~3
  group: CategoryGroup
  score: number
}

export function pickWeeklyTop3(
  news: NewsItem[],
  weekStart: string,
  weekEnd: string
): WeeklyTopPick[] {
  if (news.length === 0) return []

  const GROUP_WEIGHT: Record<CategoryGroup, number> = {
    '부동산': 1.0,
    '도시정비': 1.0,
    '광고/매체': 0.85,
    'AI': 0.7,
    '기타': 0.5,
  }

  // 광역 그룹 (다양성 강제용): 부동산+도시정비 = '주거'
  const macroGroup = (g: CategoryGroup): string => {
    if (g === '부동산' || g === '도시정비') return '주거'
    return g
  }

  // 시간 가산용: weekStart~weekEnd 범위 일수
  const startMs = new Date(weekStart + 'T00:00:00Z').getTime()
  const endMs = new Date(weekEnd + 'T00:00:00Z').getTime()
  const spanMs = Math.max(1, endMs - startMs)

  // 1) 점수 계산
  const scored = news.map(n => {
    const group = CATEGORY_GROUP_MAP[n.category] || '기타'
    let score = GROUP_WEIGHT[group] || 0.5

    // 최신성 보너스 (0 ~ 0.2): pub_date가 weekEnd에 가까울수록 가산
    const pubMs = n.pub_date ? new Date(n.pub_date).getTime() : startMs
    const ratio = Math.max(0, Math.min(1, (pubMs - startMs) / spanMs))
    score += 0.2 * ratio

    return { news: n, group, score }
  })

  // 2) source × 정규화 제목 머리 단어 기반 "주간 화제성" 보너스
  //    같은 주에 비슷한 이슈가 여러 source에서 다뤄지면 가산
  const topicKey = (n: NewsItem) => {
    // 제목 앞 8자 정규화 (공백/특수문자 제거)
    return (n.title || '').replace(/[\s\W_]+/g, '').slice(0, 8).toLowerCase()
  }
  const topicSources: Record<string, Set<string>> = {}
  for (const s of scored) {
    const k = topicKey(s.news)
    if (!k) continue
    if (!topicSources[k]) topicSources[k] = new Set()
    topicSources[k].add(s.news.source || '-')
  }
  for (const s of scored) {
    const k = topicKey(s.news)
    if (!k) continue
    const sourceCount = topicSources[k]?.size || 1
    if (sourceCount >= 3) s.score += 0.3
    else if (sourceCount >= 2) s.score += 0.15
  }

  // 3) 점수 내림차순 (동점이면 최신순)
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return (b.news.pub_date || '').localeCompare(a.news.pub_date || '')
  })

  // 4) 다양성 강제: 동일 광역그룹 2개 초과 금지, 동일 source 중복 금지(가능하면)
  const picks: WeeklyTopPick[] = []
  const macroCount: Record<string, number> = {}
  const usedSources = new Set<string>()
  // 비슷한 토픽(같은 topicKey) 중복도 방지
  const usedTopics = new Set<string>()

  const tryAdd = (item: typeof scored[0], strict: boolean): boolean => {
    if (picks.length >= 3) return false
    const macro = macroGroup(item.group)
    const tk = topicKey(item.news)
    const src = item.news.source || '-'

    if (strict) {
      // 1차 패스: 광역그룹 최대 2개 / source 중복 금지 / 토픽 중복 금지
      if ((macroCount[macro] || 0) >= 2) return false
      if (usedSources.has(src)) return false
      if (tk && usedTopics.has(tk)) return false
    } else {
      // 2차 패스: 광역그룹만 강제 (3개 다 들 수 없게)
      if ((macroCount[macro] || 0) >= 2) return false
    }

    picks.push({ news: item.news, rank: picks.length + 1, group: item.group, score: item.score })
    macroCount[macro] = (macroCount[macro] || 0) + 1
    usedSources.add(src)
    if (tk) usedTopics.add(tk)
    return true
  }

  // 1차: 엄격 조건
  for (const s of scored) {
    if (picks.length >= 3) break
    tryAdd(s, true)
  }
  // 2차: 완화 (광역그룹만 강제) — 후보 부족 시
  if (picks.length < 3) {
    for (const s of scored) {
      if (picks.length >= 3) break
      if (picks.find(p => p.news === s.news)) continue
      tryAdd(s, false)
    }
  }
  // 3차: 무조건 채움
  if (picks.length < 3) {
    for (const s of scored) {
      if (picks.length >= 3) break
      if (picks.find(p => p.news === s.news)) continue
      picks.push({ news: s.news, rank: picks.length + 1, group: s.group, score: s.score })
    }
  }

  // rank 재정렬 (1, 2, 3)
  return picks.slice(0, 3).map((p, i) => ({ ...p, rank: i + 1 }))
}
