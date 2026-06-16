// ============================================================
// 위클리 아카이브 태그 (weekly_summary_tags)
//   - 추천 태그 풀: PF / 청약 / 정책 / 브랜드 / 금리 / 입찰 / 공급
//   - 위클리 호 본문 + 한줄 요약 + TOP3 텍스트에서 키워드 매칭으로 자동 추출
//   - 결과는 weekly_summary_tags 테이블에 UPSERT (UNIQUE (week_start_date, tag))
// ============================================================

export const WEEKLY_TAG_POOL = ['PF', '청약', '정책', '브랜드', '금리', '입찰', '공급'] as const
export type WeeklyTag = typeof WEEKLY_TAG_POOL[number]

// 최대 노출 태그 수 (점수가 가장 높은 N개)
const MAX_TAGS_PER_ISSUE = 4

// 각 태그별 키워드 사전. 대소문자 무관, 부분 일치(includes) 검사
const TAG_KEYWORDS: Record<WeeklyTag, string[]> = {
  'PF': [
    'PF', '프로젝트파이낸싱', '프로젝트 파이낸싱', '부동산금융', '부동산 금융',
    '브릿지론', '브리지론', 'PF대출', 'PF 대출', 'ABL', '대출연장', '대출 연장',
    '본PF', '본 PF', 'PF사업장', 'PF 사업장', '시행사 부도', '시공사 부도',
  ],
  '청약': [
    '청약', '1순위', '2순위', '특별공급', '특별 공급', '견본주택', '모델하우스',
    '분양가', '당첨', '청약통장', '청약 통장', '청약경쟁률', '경쟁률', '미달',
    '청약홈', '예비당첨',
  ],
  '정책': [
    '정책', '정부', '국토부', '국토교통부', '규제 완화', '규제완화', '규제 강화',
    '규제강화', '법안', '시행령', '대출규제', '대출 규제', 'LTV', 'DSR',
    '전세사기', '전세 사기', '주택공급대책', '주택공급 대책', '부동산 대책',
    '부동산대책', '재건축', '재개발', '안전진단', '용적률',
  ],
  '브랜드': [
    '자이', '래미안', '푸르지오', '힐스테이트', '더샵', '롯데캐슬',
    'e편한세상', '이편한세상', '호반', '디에이치', '시그니엘', '아이파크',
    '센트레빌', '데시앙', '한양수자인', '롯데캐슬', '한신더휴', '오티에르',
  ],
  '금리': [
    '금리', '기준금리', '기준 금리', '인하', '인상', '한은', '한국은행',
    '연준', 'FOMC', '동결', '통화정책', '통화 정책', '금통위', '금융통화위',
    '주담대 금리', '주담대금리', '코픽스',
  ],
  '입찰': [
    '입찰', '낙찰', '공공입찰', '공공 입찰', '사업자 선정', '시공사 선정',
    '시공사선정', '컨소시엄', '수주', '재건축 수주', '도시정비',
    '리모델링 수주', '대형 수주',
  ],
  '공급': [
    '공급', '분양 물량', '분양물량', '입주 물량', '입주물량', '미분양',
    '신규공급', '신규 공급', '공급계획', '공급 계획', '택지', '신도시',
    '3기 신도시', '3기신도시', '주택 공급', '주택공급',
  ],
}

/**
 * 본문 텍스트에서 각 태그의 매칭 점수를 계산
 * - 점수: 매칭된 키워드 인스턴스 개수(중복 카운트, 단 같은 키워드는 1회만)
 * - 즉 키워드별 binary count → 태그별 합산
 */
export function scoreTags(text: string): Record<WeeklyTag, number> {
  const lower = (text || '').toLowerCase()
  const result = {} as Record<WeeklyTag, number>
  for (const tag of WEEKLY_TAG_POOL) {
    let score = 0
    for (const kw of TAG_KEYWORDS[tag]) {
      if (kw.length === 0) continue
      // 정책 키워드 'PF', 'LTV', 'DSR' 등 영문 키워드는 대소문자 무관 비교
      if (lower.includes(kw.toLowerCase())) {
        score += 1
      }
    }
    result[tag] = score
  }
  return result
}

/**
 * 점수표에서 상위 N개 태그 추출 (점수 0 제외, 점수 동률 시 풀 순서 유지)
 */
export function pickTopTags(scores: Record<WeeklyTag, number>, maxN: number = MAX_TAGS_PER_ISSUE): WeeklyTag[] {
  const entries: Array<{ tag: WeeklyTag; score: number; poolIndex: number }> = []
  for (let i = 0; i < WEEKLY_TAG_POOL.length; i++) {
    const tag = WEEKLY_TAG_POOL[i]
    const score = scores[tag] || 0
    if (score > 0) entries.push({ tag, score, poolIndex: i })
  }
  entries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.poolIndex - b.poolIndex  // 동률 시 풀 순서
  })
  return entries.slice(0, maxN).map((e) => e.tag)
}

/**
 * 위클리 호 텍스트로부터 태그를 추출하여 DB에 저장 (UPSERT)
 * - 기존 태그는 모두 삭제 후 재삽입 (재실행 가능)
 * - 빈 결과여도 안전하게 동작
 */
export async function extractAndSaveTags(
  db: D1Database,
  weekStart: string,
  sourceText: string,
): Promise<WeeklyTag[]> {
  const scores = scoreTags(sourceText)
  const tags = pickTopTags(scores)

  // 기존 태그 삭제 (재실행 케이스)
  await db.prepare('DELETE FROM weekly_summary_tags WHERE week_start_date = ?').bind(weekStart).run()

  // 신규 태그 삽입 (있는 경우만)
  for (const tag of tags) {
    await db.prepare(`
      INSERT OR IGNORE INTO weekly_summary_tags (week_start_date, tag, created_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).bind(weekStart, tag).run()
  }

  return tags
}

/**
 * 단일 호의 태그 조회 (풀 순서 정렬)
 */
export async function getWeeklyTags(db: D1Database, weekStart: string): Promise<WeeklyTag[]> {
  const result = await db.prepare(
    'SELECT tag FROM weekly_summary_tags WHERE week_start_date = ?'
  ).bind(weekStart).all<{ tag: string }>()
  const tags = (result.results || []).map((r) => r.tag).filter((t): t is WeeklyTag =>
    (WEEKLY_TAG_POOL as readonly string[]).includes(t)
  )
  // 풀 순서로 정렬
  return tags.sort((a, b) => WEEKLY_TAG_POOL.indexOf(a) - WEEKLY_TAG_POOL.indexOf(b))
}

/**
 * 여러 호의 태그를 한 번에 조회 (아카이브 목록용)
 * - 반환: Map<week_start_date, WeeklyTag[]>
 */
export async function getWeeklyTagsBulk(
  db: D1Database,
  weekStarts: string[],
): Promise<Map<string, WeeklyTag[]>> {
  const map = new Map<string, WeeklyTag[]>()
  if (weekStarts.length === 0) return map

  const placeholders = weekStarts.map(() => '?').join(',')
  const result = await db.prepare(
    `SELECT week_start_date, tag FROM weekly_summary_tags WHERE week_start_date IN (${placeholders})`
  ).bind(...weekStarts).all<{ week_start_date: string; tag: string }>()

  for (const row of (result.results || [])) {
    if (!(WEEKLY_TAG_POOL as readonly string[]).includes(row.tag)) continue
    const cur = map.get(row.week_start_date) || []
    cur.push(row.tag as WeeklyTag)
    map.set(row.week_start_date, cur)
  }

  // 풀 순서 정렬
  for (const [k, v] of map.entries()) {
    map.set(k, v.sort((a, b) => WEEKLY_TAG_POOL.indexOf(a) - WEEKLY_TAG_POOL.indexOf(b)))
  }
  return map
}

// 태그별 컬러/아이콘 (UI에서 일관성 있게 사용)
export const TAG_STYLE: Record<WeeklyTag, { color: string; bg: string; icon: string }> = {
  'PF':    { color: '#c0392b', bg: '#fdecea', icon: '💰' },
  '청약':  { color: '#2980b9', bg: '#e8f4fc', icon: '📝' },
  '정책':  { color: '#8e44ad', bg: '#f3e8fa', icon: '📜' },
  '브랜드':{ color: '#16a085', bg: '#e6f7f4', icon: '🏷️' },
  '금리':  { color: '#d68910', bg: '#fdf5e6', icon: '📊' },
  '입찰':  { color: '#34495e', bg: '#e8ecef', icon: '📋' },
  '공급':  { color: '#27ae60', bg: '#e8f8ee', icon: '🏗️' },
}
