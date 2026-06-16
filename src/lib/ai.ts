// Claude AI 요약 생성 (일간 + 위클리)

import {
  type NewsItem, CATEGORY_GROUP_MAP,
  type WeeklySummary, type WeeklyTopNews, type WeeklyStatus,
} from './types'
import { getSetting, SETTING_KEYS, consumeNextVolNo } from './settings'
import {
  todayKST, formatKoreanDate,
  formatWeekRangeKo, formatIssueLabelKo,
} from './utils'
import type { WeeklyTopPick } from './news'
import { extractAndSaveTags } from './weeklyTags'
import { POLITICS_GUARDRAIL_PROMPT, checkPolitics } from './politicsFilter'
import { type CompanyProfile, buildCustomGuardrail, scoreArticle } from './companyProfiles'

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'

function buildPrompt(date: string, news: NewsItem[]): string {
  // ── 2차 정치 필터: 수집 단계에서 못 잡힌 정치 기사가 LLM 입력에 들어가는 것 차단
  // (수집 필터를 거쳐도 description이 비어있던 기사 등이 후행 매칭될 수 있음)
  const filteredNews = news.filter(n => !checkPolitics({
    title: n.title, description: n.description, link: n.link
  }).isPolitical)
  const droppedCount = news.length - filteredNews.length
  if (droppedCount > 0) {
    console.log(`[AI/일간] 프롬프트 직전 정치 기사 ${droppedCount}건 추가 제외`)
  }

  // 카테고리(세부)별 분류
  const grouped: Record<string, NewsItem[]> = {}
  // 그룹(대분류)별 분류 — 광고/매체 섹션 등에 사용
  const groupedByGroup: Record<string, NewsItem[]> = {
    '부동산': [], '도시정비': [], '광고/매체': [], 'AI': [], '기타': []
  }
  for (const n of filteredNews) {
    if (!grouped[n.category]) grouped[n.category] = []
    grouped[n.category].push(n)
    const grp = CATEGORY_GROUP_MAP[n.category] || '기타'
    groupedByGroup[grp].push(n)
  }

  const adMediaCount = groupedByGroup['광고/매체'].length

  // ── 정치 콘텐츠 배제 가드레일 (프롬프트 최상단)
  let prompt = POLITICS_GUARDRAIL_PROMPT + '\n'
  prompt += `당신은 한국 건설/부동산 + 광고/매체 업계 전문 애널리스트입니다.\n`
  prompt += `모투스는 광고/마케팅 전문 기업이므로, 광고/매체 카테고리도 핵심 섹션으로 포함합니다.\n`
  prompt += `오늘(${formatKoreanDate(date)}) 수집된 ${filteredNews.length}건의 뉴스를 아래 형식에 맞춰 한국어로 요약해 주세요.\n\n`
  prompt += `# 출력 형식 (마크다운, 사실 위주, 추측 배제, 간결하게)\n\n`
  prompt += `## 📌 오늘의 핵심 이슈 TOP 3\n- 한 줄씩 3개 (각 줄 80자 이내). 부동산·도시정비·광고/매체 영역을 골고루 포함.\n\n`
  prompt += `## 🏢 분양·청약 동향\n주요 단지, 청약 결과, 분양 일정을 3-5개 불릿으로 정리\n\n`
  prompt += `## 🏗️ 도시정비 동향\n재개발/재건축/리모델링/모아타운/신통기획 등 정비사업 진행상황을 3-5개 불릿\n\n`
  // === 광고/매체 섹션 (NEW) — 데이터가 있을 때만 노출 ===
  if (adMediaCount > 0) {
    prompt += `## 📺 광고/매체 동향\n광고 산업/매체 업계 흐름을 다음 하위 섹션으로 정리 (각 항목은 1-3 불릿, 톤은 비즈니스 인사이트 위주):\n`
    prompt += `- **옥외광고**: OOH/DOOH/빌보드/디지털사이니지/미디어월 등 옥외 매체 동향\n`
    prompt += `- **디지털광고**: CTV·OTT·유튜브·틱톡·프로그래매틱·리테일미디어 등 뉴미디어 동향\n`
    prompt += `- **산업동향**: 광고시장 규모, 대행사(제일기획·이노션·HS애드 등) 실적, 광고제(칸·클리오) 수상\n`
    prompt += `- **미디어/매체사**: 방송광고, 코바코, 넷플릭스·디즈니+·티빙 광고요금제 등\n`
    prompt += `- **규제/정책**: 방통위·공정위 광고 규제, 표시광고법, 의료/금융광고 심의\n\n`
  }
  prompt += `## 📊 시장 및 정책\n부동산 정책, 규제, 금리, 시장 지표 변화를 3-5개 불릿\n\n`
  prompt += `## 🔨 건설업계 소식\n건설사 수주, 실적, 사고, 인사 등 3-5개 불릿\n\n`
  prompt += `## 💡 인사이트\n시장 흐름과 주목 포인트를 2-3문장으로 압축. 가능하면 광고/매체 업계 관점도 1문장 포함.\n\n`
  prompt += `---\n# 참고 뉴스 데이터 (그룹별)\n\n`

  // 그룹별로 묶어서 전달 (Claude가 광고/매체 섹션을 더 정확히 작성)
  for (const [grp, items] of Object.entries(groupedByGroup)) {
    if (items.length === 0) continue
    prompt += `## <${grp}> (${items.length}건)\n`
    // 그룹 내에서 다시 카테고리(세부)별로 표시
    const subByCat: Record<string, NewsItem[]> = {}
    for (const it of items) {
      if (!subByCat[it.category]) subByCat[it.category] = []
      subByCat[it.category].push(it)
    }
    for (const [cat, subItems] of Object.entries(subByCat)) {
      prompt += `### [${cat}] (${subItems.length}건)\n`
      for (const it of subItems.slice(0, 10)) {
        prompt += `- ${it.title} (${it.source})\n  ${it.description?.slice(0, 200) || ''}\n`
      }
    }
    prompt += '\n'
  }

  return prompt
}

export async function generateSummary(db: D1Database, news: NewsItem[], date: string): Promise<string> {
  const apiKey = await getSetting(db, SETTING_KEYS.CLAUDE_API_KEY)
  if (!apiKey) throw new Error('Claude API 키가 설정되지 않았습니다.')
  const model = (await getSetting(db, SETTING_KEYS.CLAUDE_MODEL)) || DEFAULT_MODEL

  if (news.length === 0) {
    return `## 📌 오늘의 핵심 이슈\n오늘 수집된 뉴스가 없습니다.`
  }

  const prompt = buildPrompt(date, news)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Claude API ${res.status}: ${errText}`)
  }

  const data = await res.json() as any
  const text = data?.content?.[0]?.text
  if (!text) throw new Error('Claude API 응답에 본문이 없습니다.')
  return text
}

export async function saveSummary(db: D1Database, date: string, content: string, articleCount: number): Promise<void> {
  await db.prepare(`
    INSERT INTO summaries (summary_date, content, article_count, created_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(summary_date) DO UPDATE SET content = excluded.content, article_count = excluded.article_count, created_at = CURRENT_TIMESTAMP
  `).bind(date, content, articleCount).run()
}

export async function getSummaryByDate(db: D1Database, date: string): Promise<{ content: string; article_count: number } | null> {
  return await db.prepare('SELECT content, article_count FROM summaries WHERE summary_date = ?')
    .bind(date).first<{ content: string; article_count: number }>()
}

export async function getRecentSummaries(db: D1Database, limit: number = 14): Promise<{ summary_date: string; article_count: number }[]> {
  const result = await db.prepare(
    'SELECT summary_date, article_count FROM summaries ORDER BY summary_date DESC LIMIT ?'
  ).bind(limit).all<{ summary_date: string; article_count: number }>()
  return result.results
}

// ════════════════════════════════════════════════════════════════════
// 위클리(Weekly) 요약 생성 — Claude 프롬프트 + 저장
// ════════════════════════════════════════════════════════════════════

/**
 * 위클리 프롬프트 빌더
 *
 * 일간 프롬프트와의 차이점:
 *   - 한 주의 흐름 / 시장 종합 시각 강조 (단편 뉴스 나열 X)
 *   - "이번 주 시장 한 줄 요약" 필수 출력 (제목 라인으로 추출)
 *   - 모투스 리서치팀이 큐레이션한 톤 (AI 자동 생성 느낌 제거)
 *   - TOP 3는 알고리즘이 선정한 것을 그대로 사용 (재정렬 금지)
 *   - 본문 풍부 → max_tokens 4096
 */
export function buildWeeklyPrompt(
  weekStart: string,
  weekEnd: string,
  top3: WeeklyTopPick[],
  news: NewsItem[],
  profile?: CompanyProfile | null,
): string {
  // ── 2차 정치 필터: 수집에서 못 잡힌 정치 기사를 LLM 입력에서 추가 제외
  const filteredNews = news.filter(n => !checkPolitics({
    title: n.title, description: n.description, link: n.link
  }).isPolitical)
  const droppedCount = news.length - filteredNews.length
  if (droppedCount > 0) {
    console.log(`[AI/위클리] 프롬프트 직전 정치 기사 ${droppedCount}건 추가 제외 (${news.length} → ${filteredNews.length})`)
  }

  // ── 회사 프로필이 있으면 점수 기반 정렬 (LLM이 상단 기사를 우선 반영)
  //    기사 자체는 제거하지 않고 순서만 변경 + 그룹 내부 정렬에 사용.
  //    카테고리별 최소 노출(아래 그룹별 출력)이 이미 구조적으로 보장됨.
  let scoredNews = filteredNews
  if (profile) {
    scoredNews = [...filteredNews].sort((a, b) => {
      const sa = scoreArticle({ title: a.title, description: a.description, category: a.category }, profile).total
      const sb = scoreArticle({ title: b.title, description: b.description, category: b.category }, profile).total
      return sb - sa
    })
    console.log(`[AI/위클리] ${profile.displayName} 프로필 점수 정렬 적용 (${scoredNews.length}건)`)
  }

  // 그룹별 분류
  const groupedByGroup: Record<string, NewsItem[]> = {
    '부동산': [], '도시정비': [], '광고/매체': [], 'AI': [], '기타': []
  }
  for (const n of scoredNews) {
    const grp = CATEGORY_GROUP_MAP[n.category] || '기타'
    groupedByGroup[grp].push(n)
  }
  const adMediaCount = groupedByGroup['광고/매체'].length

  // ── 회사별 GS/자이 같은 자사 관련 기사 별도 수집 (전용 섹션 입력용)
  const selfRelated: NewsItem[] = profile
    ? scoredNews.filter(n => {
        const t = `${n.title || ''} ${(n.description || '').slice(0, 200)}`
        return profile.focusKeywords.some(k => t.includes(k))
      }).slice(0, 12)
    : []

  const weekRangeKo = formatWeekRangeKo(weekStart, weekEnd)
  const issueLabelKo = formatIssueLabelKo(weekStart)

  // ── 정치 콘텐츠 배제 가드레일 (프롬프트 최상단) + 회사 맞춤화 가드레일
  let prompt = POLITICS_GUARDRAIL_PROMPT + '\n'
  if (profile) {
    prompt += buildCustomGuardrail(profile) + '\n'
  }
  prompt += `당신은 모투스 리서치팀의 한국 건설/부동산 + 광고/매체 업계 시니어 애널리스트입니다.\n`
  prompt += `모투스는 광고/마케팅 전문 기업이며, 이 위클리 레터는 B2B 실무자(분양·청약·광고·매체)를 대상으로 합니다.\n`
  if (profile) {
    prompt += `이번 호의 수신자는 ${profile.displayName}이며, 위 "수신자 맞춤화" 원칙을 반드시 준수해야 합니다.\n`
  }
  prompt += `이번 주(${issueLabelKo}, ${weekRangeKo})에 수집된 ${filteredNews.length}건의 뉴스를 분석하여,\n`
  prompt += `"의사결정자가 30초 안에 한 주를 파악"할 수 있는 헤드라인 모음형 위클리 레터를 한국어로 작성해 주세요.\n\n`

  // ════════════════════════════════════════════════════════════════════
  // 작성 스타일 (NEW: 헤드라인 모음 / 정보 밀도 축소)
  // ════════════════════════════════════════════════════════════════════
  prompt += `# ⚠️ 작성 스타일 — 매우 중요 (반드시 모든 항목에 적용)\n`
  prompt += `본 위클리는 "헤드라인 모음" 컨셉입니다. 의사결정자가 30초 안에 한 주를 파악해야 합니다.\n`
  prompt += `깊이 있는 분석/설명은 사이트로 유도합니다. 메일 본문은 극도로 간결해야 합니다.\n\n`

  prompt += `## [규칙 1] 한 항목 = 한 줄 (50자 이내)\n`
  prompt += `- 각 불릿은 **50자 이내, 한 줄**로 작성. (한글 기준 1글자 = 1자)\n`
  prompt += `- 설명·전망·수식어·배경 설명 모두 제거. 핵심 사실만.\n`
  prompt += `- "~한 가운데, ~로 보인다" 같은 부연 문장 금지.\n\n`

  prompt += `## [규칙 2] 형식 = "[대상] → [핵심 사실 + 숫자]"\n`
  prompt += `- 정비구역명·시공사·세대수·공사비·비례율·날짜는 정확히 표기.\n`
  prompt += `- 한 항목에 정보 2개 이상 압축 시도 (구역명+시공사+브랜드+금액 등).\n`
  prompt += `- 숫자는 그대로 표기: 4,400억 / 957세대 / 103.46% / 6월 본 입찰.\n\n`

  prompt += `## [규칙 3] 절대 사용 금지 표현\n`
  prompt += `다음 표현이 본문에 단 한 번이라도 들어가면 즉시 재작성 대상입니다:\n`
  prompt += `- "~로 알려졌다", "~할 전망이다", "~할 것으로 보인다", "~로 보인다"\n`
  prompt += `- "~한 가운데", "~인 만큼", "~에 따르면", "~인 가운데"\n`
  prompt += `- "기대된다", "주목된다", "관심이 모인다", "이목이 집중된다"\n`
  prompt += `- "치열한 경쟁을 벌이고 있는", "박차를 가하고 있는"\n\n`

  prompt += `## [규칙 4] 좋은 예시 / 나쁜 예시\n`
  prompt += `좋은 예시 (각 줄 50자 이내, 사실+숫자 압축):\n`
  prompt += `  • 압구정3구역 → GS·현대 격돌, 6월 본 입찰\n`
  prompt += `  • 한남2구역 → 관리처분 인가, 2027년 분양\n`
  prompt += `  • 신림6구역 → 비례율 103.46%, 957세대\n`
  prompt += `  • 신반포19·25차 → 삼성물산(래미안) 4,400억\n\n`
  prompt += `나쁜 예시 (절대 금지 — 길고 추측·수식어 포함):\n`
  prompt += `  ❌ "압구정3구역에서는 GS건설과 현대건설이 치열한 경쟁을 벌이고 있는\n`
  prompt += `      가운데, 6월 중 본 입찰이 진행될 예정으로 알려졌다"\n`
  prompt += `  ❌ "삼성물산 재건축 시공: 신반포19·25차 4400억원 규모 시공사 선정,\n`
  prompt += `      래미안 브랜드로 조성될 전망이다"\n\n`

  prompt += `## [규칙 5] 본문 설명 제거\n`
  prompt += `- 각 항목에 대한 부가 설명 / 배경 설명 / 의미 부여 모두 제거.\n`
  prompt += `- 분석·해석은 오직 마지막 "💡 모투스 인사이트" 섹션에서만 3~5줄로 압축.\n`
  prompt += `- 그 외 모든 섹션은 사실 헤드라인만 나열.\n\n`

  prompt += `## [규칙 6] AI 자기소개 / 톤\n`
  prompt += `- "AI가 정리했다" 표현 금지. "모투스 리서치팀이 정리"하는 톤.\n`
  prompt += `- 핵심 이슈 TOP 3는 알고리즘 선정. 본문에서 TOP 3를 재나열 금지.\n\n`

  prompt += `═════════════════════════════════════════════════════════════════\n`
  prompt += `# 📐 출력 형식 — 아래 12블록을 정확히 이 순서대로 출력하세요\n`
  prompt += `═════════════════════════════════════════════════════════════════\n\n`

  // ── [1] KEYWORD 해시태그 (NEW)
  prompt += `## 🔑 이번 주 KEYWORD\n`
  prompt += `이번 주를 관통하는 키워드 5~7개를 해시태그로 작성. **각 줄 한 개씩**, "- " 불릿으로.\n`
  prompt += `각 해시태그는 #로 시작하고 띄어쓰기 없이 8자 이내. 예시:\n`
  prompt += `- #압구정3구역\n`
  prompt += `- #관리처분\n`
  prompt += `- #PF안정화\n`
  prompt += `- #분양가상한제\n`
  prompt += `- #옥외광고\n\n`

  // ── [2] 한 줄 정리 체크리스트 (NEW)
  prompt += `## ✅ 한 줄 정리\n`
  prompt += `이번 주 시장을 5~7줄로 압축. **각 줄 50자 이내**, "- " 불릿으로 시작.\n`
  prompt += `각 줄은 "[영역] → [핵심 사실 + 숫자]" 형식. 예시:\n`
  prompt += `- 서울 정비 → 압구정3·한남2 본격화\n`
  prompt += `- 분양 → 청약경쟁률 평균 12.4:1 회복\n`
  prompt += `- 정책 → 분양가상한제 일부 완화 발표\n`
  prompt += `- PF → 금리 인하 기대로 안정세 진입\n`
  prompt += `- 광고 → CTV·리테일미디어 두 자리 성장\n\n`

  // ── [3] 시장 한 줄 요약 (기존 호환용 — extractMarketOneliner가 이 섹션을 찾음)
  prompt += `## ✍️ 이번 주 시장 한 줄 요약\n`
  prompt += `이번 주 시장 전체 흐름을 한 문장(50자 내외)으로 압축. 마침표로 끝.\n`
  prompt += `예시: "서울 정비 본격 점화, 분양 회복은 핵심지 제한적."\n\n`

  // ── [4] 도시정비 동향 ★ MAIN ★
  prompt += `## 🏗️ 도시정비 동향\n`
  prompt += `★ 메인 섹션. 재개발·재건축·리모델링·신통기획·모아타운 흐름을 **8~10개 불릿**.\n`
  prompt += `각 줄 형식: \`- [구역명] → [시공사/단계/금액/세대수 중 2~3개]\` (50자 이내)\n`
  prompt += `예시:\n`
  prompt += `- 압구정3구역 → GS·현대 격돌, 6월 본 입찰\n`
  prompt += `- 한남2구역 → 관리처분 인가, 2027년 분양\n`
  prompt += `- 신림6구역 → 비례율 103.46%, 957세대\n`
  prompt += `- 신반포19·25차 → 삼성물산(래미안) 4,400억\n`
  if (profile) {
    prompt += `※ ${profile.displayName} 수주/입찰 참여 구역은 **맨 위 1~3번 줄**에 배치.\n`
    prompt += `※ 관심 지역(${profile.watchRegions.slice(0, 6).join(', ')} 등) 우선 노출.\n`
  }
  prompt += `\n`

  // ── [5] 분양·청약
  prompt += `## 🏢 분양·청약\n`
  prompt += `이번 주 분양·청약 핵심 **5개 불릿**. 각 줄 50자 이내, "[단지/지역] → [경쟁률·세대수·일정]".\n`
  prompt += `예시:\n`
  prompt += `- 래미안 원베일리 → 청약 32.1:1, 평균 1.2억 P\n`
  prompt += `- 서초 메이플자이 → 6/12 1순위, 612세대\n\n`

  // ── [6] 건설사 동향
  prompt += `## 🔨 건설사 동향\n`
  prompt += `건설사 수주·실적·인사·사고 **5개 불릿**. 각 줄 50자 이내, "[건설사] → [핵심 사실 + 숫자]".\n`
  prompt += `예시:\n`
  prompt += `- 현대건설 → 1Q 영업이익 2,103억, +18%\n`
  prompt += `- DL이앤씨 → 한남4구역 우선협상 선정\n\n`

  // ── [7] 정책·시장
  prompt += `## 📊 정책·시장\n`
  prompt += `정책·금리·규제·지표 **3~4개 불릿**. 각 줄 50자 이내, 사실 + 숫자 위주.\n`
  prompt += `예시:\n`
  prompt += `- 분양가상한제 → 강남3구 일부 완화, 7월 시행\n`
  prompt += `- PF 잔액 → 134.2조, 전월 대비 -2.1조\n\n`

  // ── [8] 광고/매체 (조건부)
  if (adMediaCount > 0) {
    prompt += `## 📢 광고/매체\n`
    prompt += `광고·매체 시장 동향 **3개 불릿**. 각 줄 50자 이내, "[영역] → [핵심 사실 + 숫자]".\n`
    prompt += `예시:\n`
    prompt += `- CTV → 1Q 광고비 +24%, 1,840억\n`
    prompt += `- 옥외광고 → 디지털사이니지 점유율 38%\n\n`
  }

  // ── [9] 회사 전용 섹션 (profile이 있을 때만)
  if (profile) {
    prompt += `## ${profile.sectionHeader}\n`
    prompt += `${profile.displayName}/자사 브랜드 관련 이번 주 헤드라인 **5~8개 불릿**.\n`
    prompt += `각 줄 50자 이내, "[구역/사업/지표] → [핵심 사실 + 숫자]" 형식.\n`
    prompt += `수주·분양·실적·인사·기술·사회공헌·경쟁사 비교 헤드라인 모두 한 줄씩. 부정 이슈도 객관 포함.\n`
    prompt += `예시:\n`
    prompt += `- 압구정3구역 → ${profile.displayName} vs 현대건설 격돌\n`
    prompt += `- 자이 → 1Q 분양 3,210세대, 전년比 +12%\n`
    prompt += `※ "최고/독보적/압도적" 등 과장 표현 금지. 광고성 톤 금지.\n\n`
  }

  // ── [10] 모투스 인사이트 (압축)
  prompt += `## 💡 모투스 인사이트\n`
  prompt += `이번 주를 종합한 모투스 리서치팀의 관점을 **3~5줄로 압축**. (불릿 X, 단락)\n`
  prompt += `각 줄은 1문장. 추측·과장 없이 사실 기반 해석.\n`
  prompt += `예시:\n`
  prompt += `서울 핵심지 정비사업이 본격적으로 진행 단계에 진입했습니다.\n`
  prompt += `금리 인하 기대감이 PF 시장 안정화로 이어지고 있습니다.\n`
  prompt += `광고 시장에서는 CTV·리테일미디어가 주력 채널로 자리잡고 있습니다.\n\n`

  // ── [11] 다음 주 캘린더 (NEW)
  prompt += `## 📅 다음 주 캘린더\n`
  prompt += `다음 주 확인 가능한 일정을 **날짜 + 이벤트명만** 한 줄씩. 추측 일정 금지.\n`
  prompt += `형식: \`- MM/DD(요일) — [이벤트명 + 핵심]\` (각 줄 50자 이내). 자료에 일정이 없으면 "확정 일정 없음" 한 줄만.\n`
  prompt += `예시:\n`
  prompt += `- 6/10(화) — 압구정3구역 1차 사업설명회\n`
  prompt += `- 6/12(목) — 메이플자이 1순위 청약\n`
  prompt += `- 6/13(금) — 한은 금통위 기준금리 발표\n\n`

  // ─────────────────────────────────────────────────────────────
  // 참고 데이터
  // ─────────────────────────────────────────────────────────────
  prompt += `---\n# 참고: 알고리즘이 선정한 TOP 3 (본문에서 재나열 금지)\n`
  for (const p of top3) {
    prompt += `- [${p.group}] ${p.news.title} (${p.news.source || '-'})\n`
  }

  // 회사 전용 섹션 입력 데이터 (selfRelated 기사)
  if (profile && selfRelated.length > 0) {
    prompt += `\n---\n# 참고: ${profile.displayName} 관련 자사 기사 (${selfRelated.length}건, "${profile.sectionHeader}" 섹션 작성용)\n`
    for (const it of selfRelated) {
      prompt += `- [${it.category}] ${it.title} (${it.source})\n  ${it.description?.slice(0, 200) || ''}\n`
    }
  } else if (profile) {
    prompt += `\n---\n# 참고: ${profile.displayName} 관련 자사 기사 (이번 주 ${profile.displayName} 관련 뉴스 부족)\n`
    prompt += `※ 자사 기사가 부족하므로 "${profile.sectionHeader}" 섹션에는 그 사실을 명시하고 다음 주 주목 일정만 간단히 정리하세요.\n`
  }

  prompt += `\n---\n# 참고: 이번 주 수집 뉴스 (그룹별)\n\n`
  for (const [grp, items] of Object.entries(groupedByGroup)) {
    if (items.length === 0) continue
    prompt += `## <${grp}> (${items.length}건)\n`
    const subByCat: Record<string, NewsItem[]> = {}
    for (const it of items) {
      if (!subByCat[it.category]) subByCat[it.category] = []
      subByCat[it.category].push(it)
    }
    for (const [cat, subItems] of Object.entries(subByCat)) {
      prompt += `### [${cat}] (${subItems.length}건)\n`
      // 주간이므로 카테고리당 더 많이 보여줌 (일간 10개 → 위클리 15개)
      for (const it of subItems.slice(0, 15)) {
        prompt += `- ${it.title} (${it.source})\n  ${it.description?.slice(0, 200) || ''}\n`
      }
    }
    prompt += '\n'
  }

  return prompt
}

/**
 * 위클리 요약 본문에서 "이번 주 시장 한 줄 요약" 추출
 * - 마크다운 본문에서 "## ✍️ 이번 주 시장 한 줄 요약" 다음 줄의 첫 비어있지 않은 라인을 추출
 * - 없으면 null
 */
export function extractMarketOneliner(content: string): string | null {
  if (!content) return null
  // 한 줄 요약 섹션 매칭 (이모지/특수문자는 .*?로 관대하게)
  // 예: "## ✍️ 이번 주 시장 한 줄 요약" / "## 이번 주 시장 한 줄 요약" / "## ✍ 이번 주 시장 한 줄 요약"
  const re = /##\s*[^a-zA-Z\n]*이번\s*주\s*시장\s*한\s*줄\s*요약[^\n]*\n+([\s\S]*?)(?=\n##|$)/i
  const m = content.match(re)
  if (!m || !m[1]) return null

  // 매칭된 블록에서 의미있는 라인 추출
  const rawLines = m[1].split('\n').map(l => l.trim())
  const meaningfulLines = rawLines.filter(l =>
    l &&
    !l.startsWith('#') &&
    !l.startsWith('예시') &&
    !l.startsWith('>') &&
    !l.match(/^[-*]\s*$/) &&  // 빈 불릿 제외
    l.length >= 5
  )

  let line = meaningfulLines[0] || ''
  if (!line) return null

  // 마크다운 잡음 제거 (불릿/굵게 표시)
  line = line.replace(/^[-*]\s+/, '').replace(/\*\*/g, '').trim()

  // 길이 제한 (200자) — UI 안전
  if (line.length > 200) line = line.slice(0, 197) + '...'
  return line || null
}

/**
 * 위클리 요약 생성 (Claude 호출)
 * news.length === 0이면 빈 요약 반환
 *
 * @param profile - 회사 프로필. null이면 일반본, CompanyProfile이면 맞춤본 생성.
 */
export async function generateWeeklySummary(
  db: D1Database,
  weekStart: string,
  weekEnd: string,
  top3: WeeklyTopPick[],
  news: NewsItem[],
  profile?: CompanyProfile | null,
): Promise<string> {
  const apiKey = await getSetting(db, SETTING_KEYS.CLAUDE_API_KEY)
  if (!apiKey) throw new Error('Claude API 키가 설정되지 않았습니다.')
  const model = (await getSetting(db, SETTING_KEYS.CLAUDE_MODEL)) || DEFAULT_MODEL

  if (news.length === 0) {
    return `## ✍️ 이번 주 시장 한 줄 요약\n이번 주 수집된 뉴스가 없습니다.\n`
  }

  const prompt = buildWeeklyPrompt(weekStart, weekEnd, top3, news, profile ?? null)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,  // 위클리는 본문 풍부
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Claude API ${res.status}: ${errText}`)
  }

  const data = await res.json() as any
  const text = data?.content?.[0]?.text
  if (!text) throw new Error('Claude API 응답에 본문이 없습니다.')
  return text
}

/**
 * 위클리 호 저장 (weekly_summaries + weekly_top_news 동시 INSERT)
 *
 * - VOL 번호는 consumeNextVolNo로 원자적 증가
 * - 동일 week_start_date 재실행 시: UPDATE (UPSERT). top3는 DELETE→INSERT
 * - top3 INSERT 실패 시 weekly_summaries는 status='draft'로 남김 (재시도 가능)
 *
 * 반환: { volNo, isNew }
 */
export async function saveWeeklySummary(params: {
  db: D1Database
  weekStart: string
  weekEnd: string
  issueDate: string
  content: string
  marketOneliner: string | null
  top3: WeeklyTopPick[]
  articleCount: number
  status?: WeeklyStatus
}): Promise<{ volNo: number; isNew: boolean }> {
  const { db, weekStart, weekEnd, issueDate, content, marketOneliner, top3, articleCount } = params
  const status: WeeklyStatus = params.status ?? 'ready'

  // 기존 레코드 확인 (재실행 케이스)
  const existing = await db.prepare(
    'SELECT id, vol_no FROM weekly_summaries WHERE week_start_date = ?'
  ).bind(weekStart).first<{ id: number; vol_no: number }>()

  let volNo: number
  let isNew: boolean

  if (existing) {
    // 기존 호 업데이트 (VOL 재사용, 카운터 증가 X)
    volNo = existing.vol_no
    isNew = false
    await db.prepare(`
      UPDATE weekly_summaries
      SET week_end_date = ?,
          issue_date = ?,
          market_oneliner = ?,
          content = ?,
          article_count = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE week_start_date = ?
    `).bind(weekEnd, issueDate, marketOneliner, content, articleCount, status, weekStart).run()

    // top3 갱신: 기존 삭제 후 재삽입
    await db.prepare('DELETE FROM weekly_top_news WHERE week_start_date = ?').bind(weekStart).run()
  } else {
    // 신규 호: VOL 카운터 소비 (원자적 증가)
    volNo = await consumeNextVolNo(db)
    isNew = true
    await db.prepare(`
      INSERT INTO weekly_summaries
        (week_start_date, week_end_date, vol_no, issue_date, market_oneliner, content, article_count, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(weekStart, weekEnd, volNo, issueDate, marketOneliner, content, articleCount, status).run()
  }

  // TOP 3 삽입
  for (const p of top3) {
    await db.prepare(`
      INSERT INTO weekly_top_news
        (week_start_date, rank, news_id, title, summary, link, source, category, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      weekStart,
      p.rank,
      p.news.id ?? null,
      p.news.title,
      null,                         // summary는 추후 별도 단계에서 채울 수 있음
      p.news.link ?? null,
      p.news.source ?? null,
      p.news.category ?? null,
    ).run()
  }

  // 아카이브 태그 자동 추출 (실패해도 위클리 저장 자체는 성공으로 처리)
  try {
    const sourceText = [
      marketOneliner || '',
      content || '',
      ...top3.map((p) => `${p.news.title || ''} ${p.news.category || ''}`),
    ].join('\n')
    await extractAndSaveTags(db, weekStart, sourceText)
  } catch (err) {
    console.warn('[saveWeeklySummary] extractAndSaveTags 실패:', err)
  }

  return { volNo, isNew }
}

/**
 * 특정 주의 위클리 호 조회 (본문 + TOP 3 포함)
 */
export async function getWeeklySummary(
  db: D1Database,
  weekStart: string
): Promise<{ summary: WeeklySummary; top3: WeeklyTopNews[] } | null> {
  const summary = await db.prepare(
    'SELECT * FROM weekly_summaries WHERE week_start_date = ?'
  ).bind(weekStart).first<WeeklySummary>()
  if (!summary) return null

  const top3Result = await db.prepare(
    'SELECT * FROM weekly_top_news WHERE week_start_date = ? ORDER BY rank ASC'
  ).bind(weekStart).all<WeeklyTopNews>()

  return { summary, top3: top3Result.results }
}

/**
 * 가장 최근 발행된 위클리 호 (메인페이지 "이번 주 호" 표시용)
 * status가 'ready' 또는 'sent'인 것 중 issue_date 최신
 */
export async function getLatestWeeklySummary(
  db: D1Database
): Promise<{ summary: WeeklySummary; top3: WeeklyTopNews[] } | null> {
  const summary = await db.prepare(`
    SELECT * FROM weekly_summaries
    WHERE status IN ('ready', 'sent')
    ORDER BY issue_date DESC, vol_no DESC
    LIMIT 1
  `).first<WeeklySummary>()
  if (!summary) return null

  const top3Result = await db.prepare(
    'SELECT * FROM weekly_top_news WHERE week_start_date = ? ORDER BY rank ASC'
  ).bind(summary.week_start_date).all<WeeklyTopNews>()

  return { summary, top3: top3Result.results }
}

/**
 * 최근 위클리 호 목록 (아카이브용)
 * - draft 제외
 */
export async function getRecentWeeklySummaries(
  db: D1Database,
  limit: number = 12
): Promise<Array<Pick<WeeklySummary, 'week_start_date' | 'week_end_date' | 'vol_no' | 'issue_date' | 'market_oneliner' | 'article_count' | 'status'>>> {
  const result = await db.prepare(`
    SELECT week_start_date, week_end_date, vol_no, issue_date, market_oneliner, article_count, status
    FROM weekly_summaries
    WHERE status IN ('ready', 'sent')
    ORDER BY issue_date DESC, vol_no DESC
    LIMIT ?
  `).bind(limit).all<any>()
  return result.results
}

// ─────────────────────────────────────────────────────────────────────────
// 회사별 맞춤 위클리 저장/조회
// ─────────────────────────────────────────────────────────────────────────

export interface PersonalizedWeeklyRow {
  id: number
  week_start_date: string
  week_end_date: string
  company_profile: string
  vol_no: number
  issue_date: string
  market_oneliner: string | null
  content: string
  article_count: number
  verification: string | null
  status: WeeklyStatus
  created_at: string
  updated_at: string
}

/**
 * 회사별 위클리 호 저장 (UPSERT by (week_start_date, company_profile))
 *
 * - VOL은 동일 주의 일반본 VOL을 그대로 가져옴 (없으면 0)
 * - verification은 JSON 문자열 (CompanyVerificationResult)
 */
export async function savePersonalizedWeeklySummary(params: {
  db: D1Database
  weekStart: string
  weekEnd: string
  companyProfile: string
  issueDate: string
  content: string
  marketOneliner: string | null
  articleCount: number
  verification?: string | null
  status?: WeeklyStatus
}): Promise<{ isNew: boolean }> {
  const { db, weekStart, weekEnd, companyProfile, issueDate, content, marketOneliner, articleCount, verification } = params
  const status: WeeklyStatus = params.status ?? 'ready'

  // 같은 주의 일반본 VOL 가져오기 (있으면 그대로 사용, 없으면 0)
  const generalRow = await db.prepare(
    'SELECT vol_no FROM weekly_summaries WHERE week_start_date = ?'
  ).bind(weekStart).first<{ vol_no: number }>()
  const volNo = generalRow?.vol_no ?? 0

  const existing = await db.prepare(
    'SELECT id FROM weekly_personalized_summaries WHERE week_start_date = ? AND company_profile = ?'
  ).bind(weekStart, companyProfile).first<{ id: number }>()

  if (existing) {
    await db.prepare(`
      UPDATE weekly_personalized_summaries
      SET week_end_date = ?, vol_no = ?, issue_date = ?, market_oneliner = ?, content = ?,
          article_count = ?, verification = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE week_start_date = ? AND company_profile = ?
    `).bind(weekEnd, volNo, issueDate, marketOneliner, content, articleCount,
            verification ?? null, status, weekStart, companyProfile).run()
    return { isNew: false }
  } else {
    await db.prepare(`
      INSERT INTO weekly_personalized_summaries
        (week_start_date, week_end_date, company_profile, vol_no, issue_date,
         market_oneliner, content, article_count, verification, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(weekStart, weekEnd, companyProfile, volNo, issueDate,
            marketOneliner, content, articleCount, verification ?? null, status).run()
    return { isNew: true }
  }
}

export async function getPersonalizedWeeklySummary(
  db: D1Database,
  weekStart: string,
  companyProfile: string,
): Promise<PersonalizedWeeklyRow | null> {
  return await db.prepare(
    'SELECT * FROM weekly_personalized_summaries WHERE week_start_date = ? AND company_profile = ?'
  ).bind(weekStart, companyProfile).first<PersonalizedWeeklyRow>()
}

/**
 * 회사 맞춤 위클리 모든 회사 버전 일괄 조회 (특정 주차)
 * — 발송 라우팅에서 회사별로 본문을 매핑할 때 사용
 */
export async function listPersonalizedWeeklySummariesByWeek(
  db: D1Database,
  weekStart: string,
): Promise<PersonalizedWeeklyRow[]> {
  const r = await db.prepare(
    'SELECT * FROM weekly_personalized_summaries WHERE week_start_date = ? ORDER BY company_profile ASC'
  ).bind(weekStart).all<PersonalizedWeeklyRow>()
  return r.results
}

// ─────────────────────────────────────────────────────────────────────────
// 운영자 1차 검수 (operator review)
// — 자동 검증(verifyCompanySummary) 통과 후, 발송 전 운영자가 본문 검토
// — "부정적 사실 누락 없음 / 회사 메시지 관점 OK" 등 자동화 불가 영역
// ─────────────────────────────────────────────────────────────────────────

export type OperatorReviewStatus = 'pending' | 'approved' | 'rejected'

export interface OperatorReviewInput {
  weekStart: string
  companyProfile: string
  status: OperatorReviewStatus
  notes?: string | null
  reviewedBy: number // admin user id
}

/**
 * 운영자 검수 결과 반영
 * - approved → weekly_personalized_summaries.status = 'approved' (발송 가능)
 * - rejected → status = 'held'  (재생성 필요)
 * - pending  → 검수 보류 상태 유지
 */
export async function setOperatorReview(
  db: D1Database,
  input: OperatorReviewInput,
): Promise<{ ok: boolean; newStatus: string }> {
  const now = new Date().toISOString()
  let newRowStatus: string
  if (input.status === 'approved') newRowStatus = 'approved'
  else if (input.status === 'rejected') newRowStatus = 'held'
  else newRowStatus = 'ready' // pending

  const r = await db.prepare(`
    UPDATE weekly_personalized_summaries
    SET operator_review_status = ?,
        operator_review_notes  = ?,
        operator_reviewed_by   = ?,
        operator_reviewed_at   = ?,
        status                 = ?,
        updated_at             = CURRENT_TIMESTAMP
    WHERE week_start_date = ? AND company_profile = ?
  `).bind(
    input.status,
    input.notes ?? null,
    input.reviewedBy,
    now,
    newRowStatus,
    input.weekStart,
    input.companyProfile,
  ).run()

  return { ok: ((r.meta && (r.meta as any).changes) || 0) > 0, newStatus: newRowStatus }
}

/**
 * 운영자 검수 가능한 위클리 목록 (status='ready' 인 항목 = 자동검증 통과, 검수 대기)
 */
export async function listPendingOperatorReviews(
  db: D1Database,
): Promise<PersonalizedWeeklyRow[]> {
  const r = await db.prepare(`
    SELECT * FROM weekly_personalized_summaries
    WHERE status = 'ready' AND operator_review_status = 'pending'
    ORDER BY week_start_date DESC, company_profile ASC
  `).all<PersonalizedWeeklyRow>()
  return r.results
}
