// 정치 콘텐츠 필터링 라이브러리
// ───────────────────────────────────────────────────────────────────────
// 모투스 위클리/데일리는 건설·분양 업계 B2B 의사결정자(시행사·시공사·조합·
// 투자자)를 위한 사업 정보 매체입니다. 정치인 발언/공약/유세, 정당 정쟁,
// 사설/오피니언은 부적합하므로 수집·요약 단계에서 제거합니다.
//
// 운영 원칙
//   1. 부처/공식기관(국토교통부·기획재정부·한국은행 등)의 공식 정책 발표는
//      "정책·시장" 영역으로 유효 → 화이트리스트로 보호
//   2. 정치인 인명·정당명·선거 키워드가 제목에 등장하면 즉시 제외
//   3. /politics/, /opinion/, /editorial/ 등 정치·사설 섹션 URL은 제외
//   4. 발송 직전 요약 본문도 sanityCheck로 한 번 더 검증

// ─────────────────────────────────────────────────────────────────────
// 1) 정치 키워드 블랙리스트 (제목 또는 본문 첫 200자에 포함 시 제외)
// ─────────────────────────────────────────────────────────────────────
export const POLITICS_KEYWORDS: string[] = [
  // 선거 일반
  '지방선거', '총선', '재보선', '재보궐', '보궐선거', '대선', '대통령선거',
  '후보', '공약', '유세', '지원유세', '당선', '낙선', '출마', '경선',
  '당대표', '원내대표', '비대위', '비상대책위', '최고위',
  // 정당명 (현역 주요 정당)
  '민주당', '국민의힘', '조국혁신당', '진보당', '개혁신당',
  '정의당', '기본소득당', '사회민주당',
  // 권력기관/정쟁 표현
  '대통령실', '청와대', '탄핵', '여야', '여야정', '야권', '여권',
  '의원실', '국회의원', '의원단', '원내', '정쟁',
]

// ─────────────────────────────────────────────────────────────────────
// 2) 정치인 인명 리스트 (현역 핵심 정치인. 제목 첫 30자 안에 등장하면 가중)
//    ※ 본 리스트는 운영 중 보수/진보 균형있게 갱신해야 합니다.
//    ※ "○○ 의원", "○○ 후보" 같은 호칭과 결합되면 위 KEYWORDS로 잡힙니다.
// ─────────────────────────────────────────────────────────────────────
export const POLITICIAN_NAMES: string[] = [
  // 정당 지도부/대표급 (참고용 — 시기에 따라 갱신 필요)
  '이재명', '한동훈', '조국', '이준석', '이낙연', '안철수',
  '홍준표', '오세훈', '김동연', '박형준',
  // 대통령/총리급
  '윤석열', '이재명', '한덕수', '김부겸',
]

// ─────────────────────────────────────────────────────────────────────
// 3) URL 패턴 블랙리스트 (해당 경로 포함 시 무조건 제외)
// ─────────────────────────────────────────────────────────────────────
export const POLITICS_URL_PATTERNS: RegExp[] = [
  /\/politics\//i,
  /\/political\//i,
  /\/opinion\//i,
  /\/opinions\//i,
  /\/editorial\//i,
  /\/column\//i,
  /\/columns\//i,
  /\/series\/column\//i,
  /\/election\//i,
  /\/vote\//i,
]

// ─────────────────────────────────────────────────────────────────────
// 4) 화이트리스트 — 정부 부처/공식 기관 공식 발표는 정책·시장 정보로 유효
//    아래 키워드가 제목에 있고, 동시에 위 블랙리스트에 걸리지 않으면 통과
// ─────────────────────────────────────────────────────────────────────
export const GOV_AGENCY_WHITELIST: string[] = [
  '국토교통부', '국토부',
  '기획재정부', '기재부',
  '금융위원회', '금융위',
  '금융감독원', '금감원',
  '한국은행', '한은',
  '주택도시보증공사', 'HUG',
  '한국주택금융공사', 'HF',
  '한국부동산원',
  '한국토지주택공사', 'LH',
  '서울주택도시공사', 'SH',
  '경기주택도시공사', 'GH',
  '공정거래위원회', '공정위',
  '통계청', '국세청',
]

// ─────────────────────────────────────────────────────────────────────
// 판정 함수
// ─────────────────────────────────────────────────────────────────────

export interface PoliticsCheckResult {
  isPolitical: boolean
  reasons: string[]   // 매칭된 사유 (디버깅/운영 리포트용)
  matched: {
    keywords: string[]
    politicians: string[]
    urlPatterns: string[]
  }
}

/** 텍스트에 정치 키워드가 포함되었는지 검사 (단어 경계 고려) */
function findKeywordsIn(text: string, keywords: string[]): string[] {
  if (!text) return []
  const hit: string[] = []
  for (const kw of keywords) {
    if (text.includes(kw)) hit.push(kw)
  }
  return hit
}

/** 제목 첫 30자 안에 정치인 인명이 등장하는지 검사 (우선순위 ↑ 판정용) */
function findPoliticiansInTitleHead(title: string): string[] {
  if (!title) return []
  const head = title.slice(0, 30)
  const hit: string[] = []
  for (const name of POLITICIAN_NAMES) {
    if (head.includes(name)) hit.push(name)
  }
  return hit
}

/** 제목 전체 + 본문 첫 200자 범위에 정치인 인명이 등장하는지 검사 */
function findPoliticiansInTextScope(title: string, bodyHead: string): string[] {
  const text = `${title || ''} ${bodyHead || ''}`
  if (!text.trim()) return []
  const hit: string[] = []
  for (const name of POLITICIAN_NAMES) {
    if (text.includes(name)) hit.push(name)
  }
  return hit
}

/** URL이 정치·사설 섹션 패턴에 해당하는지 검사 */
function findUrlPatternMatches(url: string): string[] {
  if (!url) return []
  const hit: string[] = []
  for (const re of POLITICS_URL_PATTERNS) {
    if (re.test(url)) hit.push(re.source)
  }
  return hit
}

/**
 * 기사 단위 정치 콘텐츠 판정
 *
 * 우선순위:
 *   1) URL 패턴 매칭 → 무조건 정치
 *   2) 제목 첫 30자 내 정치인 인명 → 정치
 *   3) 제목/본문(앞 200자) 내 정치 키워드 매칭 →
 *        화이트리스트(부처명)도 함께 등장하면 "정책 발표 기사"로 보고 통과
 *        화이트리스트 없으면 정치
 */
export function checkPolitics(args: {
  title: string
  description?: string | null
  link?: string | null
}): PoliticsCheckResult {
  const title = args.title || ''
  const description = args.description || ''
  const link = args.link || ''
  const bodyHead = description.slice(0, 200)
  const combined = `${title} ${bodyHead}`

  const matchedKeywords = findKeywordsIn(combined, POLITICS_KEYWORDS)
  const politiciansInTitleHead = findPoliticiansInTitleHead(title)
  // 제목 전체 + 본문 200자 범위 정치인 스캔 (description 안에 정치인 발언 인용된 경우 포착)
  const politiciansInScope = findPoliticiansInTextScope(title, bodyHead)
  // 매칭 통합 (운영 리포트/감사용 — 중복 제거)
  const matchedPoliticians = Array.from(new Set([...politiciansInTitleHead, ...politiciansInScope]))
  const matchedUrls = findUrlPatternMatches(link)
  const whitelistHits = findKeywordsIn(combined, GOV_AGENCY_WHITELIST)

  const reasons: string[] = []

  // 1) URL 패턴 — 정치/사설/오피니언 섹션 URL은 무조건 제외
  if (matchedUrls.length > 0) {
    reasons.push(`URL 패턴 매칭: ${matchedUrls.join(', ')}`)
    return {
      isPolitical: true,
      reasons,
      matched: { keywords: matchedKeywords, politicians: matchedPoliticians, urlPatterns: matchedUrls },
    }
  }

  // 2) 제목 첫 30자 내 정치인 인명 — 정치인 인터뷰/발언 위주 기사 가능성 高
  if (politiciansInTitleHead.length > 0) {
    reasons.push(`제목 첫 30자 내 정치인: ${politiciansInTitleHead.join(', ')}`)
    return {
      isPolitical: true,
      reasons,
      matched: { keywords: matchedKeywords, politicians: matchedPoliticians, urlPatterns: matchedUrls },
    }
  }

  // 2-b) 본문(첫 200자)에 정치인 인명이 등장하는 경우
  //      — 정치인 발언/논평/비판 인용 기사 → 부처 화이트리스트 동반 여부와 무관하게 차단
  //      (사용자 요청 D항: "정치인이 부처 정책을 비판/논평하는 기사는 제외")
  const politiciansInBodyOnly = politiciansInScope.filter(n => !politiciansInTitleHead.includes(n))
  if (politiciansInBodyOnly.length > 0) {
    reasons.push(`본문 정치인 인용: ${politiciansInBodyOnly.join(', ')}`)
    return {
      isPolitical: true,
      reasons,
      matched: { keywords: matchedKeywords, politicians: matchedPoliticians, urlPatterns: matchedUrls },
    }
  }

  // 3) 정치 키워드 매칭 — 단, 부처/공식기관 화이트리스트가 함께 있으면 정책 기사로 보고 통과
  if (matchedKeywords.length > 0) {
    if (whitelistHits.length > 0) {
      // 부처명이 함께 등장 → 정책 발표 기사로 간주하여 통과
      // 단, "후보/공약/유세/탄핵" 등 명백한 정치 행위 키워드가 함께 있으면 차단
      const hardPoliticalKws = matchedKeywords.filter(kw =>
        ['후보', '공약', '유세', '지원유세', '당선', '낙선', '출마', '경선',
         '탄핵', '비대위', '비상대책위', '대선', '대통령선거', '총선',
         '지방선거', '재보선', '재보궐', '보궐선거'].includes(kw)
      )
      if (hardPoliticalKws.length > 0) {
        reasons.push(`정치 키워드 매칭 (화이트리스트 무력화: ${hardPoliticalKws.join(', ')})`)
        return {
          isPolitical: true,
          reasons,
          matched: { keywords: matchedKeywords, politicians: matchedPoliticians, urlPatterns: matchedUrls },
        }
      }
      // 본문 정치인 케이스는 위 2-b)에서 이미 차단됨.
      // 여기서는 키워드(예: "여야", "민주당" 등)만 등장하고 부처가 함께 있는 케이스 →
      // 부처 발표 맥락에서 등장 가능한 표현으로 보고 통과
      return {
        isPolitical: false,
        reasons: [`부처 화이트리스트(${whitelistHits.join(', ')})로 정책 기사 통과`],
        matched: { keywords: matchedKeywords, politicians: matchedPoliticians, urlPatterns: matchedUrls },
      }
    }
    reasons.push(`정치 키워드 매칭: ${matchedKeywords.join(', ')}`)
    return {
      isPolitical: true,
      reasons,
      matched: { keywords: matchedKeywords, politicians: matchedPoliticians, urlPatterns: matchedUrls },
    }
  }

  return {
    isPolitical: false,
    reasons: [],
    matched: { keywords: [], politicians: [], urlPatterns: [] },
  }
}

// ─────────────────────────────────────────────────────────────────────
// 5) AI 요약 가드레일 블록 (일간/위클리 프롬프트 맨 앞에 삽입)
// ─────────────────────────────────────────────────────────────────────
export const POLITICS_GUARDRAIL_PROMPT = `
[필수 준수 사항 — 정치 콘텐츠 배제]

본 뉴스레터는 건설·분양 업계 의사결정자(시행사·시공사·조합·투자자·부동산 실무자)를 위한 사업 정보 매체입니다. 다음 원칙을 반드시 지켜주세요.

1. 다음 내용은 요약에 절대 포함하지 마세요:
   - 정치인의 발언, 공약, 인터뷰, 비판
   - 선거, 정당, 후보, 유세, 경선, 출마, 당선/낙선 관련 내용
   - 정책에 대한 정치적 옹호나 비판
   - 특정 정치 성향이 드러나는 표현
   - "민주당", "국민의힘" 등 정당명 언급
   - "○○ 후보", "○○ 의원" 등 정치인 인명

2. 정부 정책은 "팩트와 시장 영향"만 다룹니다.
   ❌ 나쁜 예: "○○ 후보가 재개발 활성화 공약 발표"
   ❌ 나쁜 예: "○○ 의원, 부동산 정책 비판"
   ⭕ 좋은 예: "국토부, 도심공공주택복합사업 일몰 폐지. 사업장 ○○개소 영향 예상"
   ⭕ 좋은 예: "다주택자 양도세 중과 재시행. 서울 아파트 매물 2,000건 감소"

3. 도시정비 섹션은 반드시 다음 요소 중심으로 구성:
   - 특정 정비구역명과 사업 진행 단계
     (예: 압구정3구역 시공사 선정, 신림6구역 비례율 103.46%)
   - 시공사 선정 결과 및 입찰 동향
   - 조합 의사결정, 분담금, 일반분양가
   - 사업성 지표 (비례율, 분양가, 공급 세대수, 용적률)
   - 행정 인허가 진행 상황 (관리처분, 사업시행계획 등)

   정치인이 재개발/재건축을 언급한 기사는 "도시정비"가 아닙니다. 해당 기사는 요약에서 제외하세요.

4. 입력 기사 중 정치적 성격이 짙은 것은 요약에서 제외하고, 같은 카테고리의 다른 사업 정보 기사로 대체하세요.

5. 본 뉴스레터의 메인 범위는 다음으로 한정합니다:
   분양·청약 / 도시정비(재개발·재건축) / 정책·시장(부동산) / 건설사 동향
   ※ 광고·매체 섹션은 별도로 안내된 경우에만 포함하고, 정치적 광고 규제는 다루지 않습니다.

---
`

// ─────────────────────────────────────────────────────────────────────
// 6) 발송 직전 자동 체크리스트 — 요약 본문 sanity check
// ─────────────────────────────────────────────────────────────────────
export interface SanityCheckResult {
  passed: boolean
  hits: {
    keywords: string[]
    politicians: string[]
    adMediaTerms: string[]
  }
  warnings: string[]
}

// 발송 본문에 등장하면 안 되는 광고·매체 산업 용어 (B2B 부동산 매체 범위 외)
const AD_MEDIA_TERMS_IN_BODY = ['OTT', '유튜브', '틱톡', '디지털사이니지', '옥외광고']

/**
 * 요약 본문(마크다운)에 정치 키워드/정치인 인명/광고·매체 용어가 등장하는지 검사.
 * weeklyJob/dailyJob 발송 직전에 호출하여 매칭되면 result.errors에 기록하고 로그.
 */
export function sanityCheckSummary(summaryContent: string): SanityCheckResult {
  const warnings: string[] = []
  const text = summaryContent || ''

  const kw = findKeywordsIn(text, POLITICS_KEYWORDS)
  const pol = POLITICIAN_NAMES.filter(n => text.includes(n))
  const adMedia = AD_MEDIA_TERMS_IN_BODY.filter(t => text.includes(t))

  if (kw.length > 0) warnings.push(`정치 키워드 등장: ${kw.join(', ')}`)
  if (pol.length > 0) warnings.push(`정치인 인명 등장: ${pol.join(', ')}`)
  if (adMedia.length > 0) warnings.push(`광고·매체 용어 등장(섹션 외): ${adMedia.join(', ')}`)

  return {
    passed: warnings.length === 0,
    hits: { keywords: kw, politicians: pol, adMediaTerms: adMedia },
    warnings,
  }
}
