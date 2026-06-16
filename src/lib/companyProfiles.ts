// 수신자(건설사)별 맞춤 프로필 라이브러리
// ───────────────────────────────────────────────────────────────────────
// 모투스 위클리/데일리 뉴스레터는 발송 대상 건설사에 따라
// (1) 기사 점수 가중치
// (2) LLM 프롬프트의 가드레일 블록
// (3) 발송 직전 검증 체크리스트
// 가 달라집니다.
//
// 이 파일은 회사별 프로필을 한 곳에 정의하여 ai.ts / weeklyJob.ts /
// 점수 시스템에서 동일하게 참조하도록 합니다.
//
// 새 건설사 추가 절차:
//   1) 아래 COMPANY_PROFILES에 새 entry 추가
//   2) subscribers.company_profile 컬럼에 새 키 사용
//   3) (선택) buildCustomGuardrail()을 회사별로 분기

export interface CompanyProfile {
  /** 프로필 고유 키 (subscribers.company_profile에 저장) */
  key: string
  /** 표시용 회사명 */
  displayName: string
  /** 자사 키워드 (브랜드명, 자회사, 임원 등) — 점수 +50 */
  focusKeywords: string[]
  /** 경쟁사 키워드 (Top 10 건설사 + 주요 브랜드) — 점수 +20 */
  competitorKeywords: string[]
  /** 관심 정비구역 (강남권/한강변 등) — 점수 +30 */
  watchRegions: string[]
  /** 회사 전용 섹션 헤더 (요약 본문에 삽입) */
  sectionHeader: string
  /** 검증 단계에서 본문에 최소 N회 등장해야 하는 자사 키워드 수 */
  minSelfKeywordOccurrences: number
  /** 검증 단계에서 본문에 등장해야 하는 최소 경쟁사 수 */
  minCompetitorCompanies: number
}

// ─────────────────────────────────────────────────────────────────────────
// GS건설 프로필 (1차 발송 대상)
// ─────────────────────────────────────────────────────────────────────────
export const GS_PROFILE: CompanyProfile = {
  key: 'gs',
  displayName: 'GS건설',
  focusKeywords: [
    'GS건설', '지에스건설', '자이', 'Xi', 'Self',
    '자이에스앤디', 'GS이앤알', 'GS이앤씨', 'GS E&C',
    '허윤홍', 'GS건설 대표', '자이르네', '자이아파트',
  ],
  competitorKeywords: [
    '현대건설', '힐스테이트', '디에이치', 'THE H',
    '삼성물산', '삼성물산 건설부문', '래미안', 'RAEMIAN',
    '대우건설', '푸르지오', '써밋', 'SUMMIT',
    'DL이앤씨', 'DL E&C', 'e편한세상', '아크로', 'ACRO',
    '포스코이앤씨', 'POSCO E&C', '더샵', 'THE SHARP',
    '롯데건설', '롯데캐슬', 'LOTTE Castle',
    'SK에코플랜트', 'SK뷰', 'SK VIEW',
    'HDC현대산업개발', '아이파크', 'IPARK',
    '현대엔지니어링', '힐스테이트', 'HillState',
    '한화건설', '꿈에그린', '포레나',
  ],
  watchRegions: [
    // 강남권
    '압구정', '반포', '잠실', '도곡', '개포', '대치', '청담', '삼성', '서초',
    // 한강변·핵심지
    '한남', '여의도', '성수', '용산', '이촌',
    // 강북·강서·강동 주요
    '상계', '목동', '신정', '둔촌', '명일',
    // 1기 신도시
    '분당', '일산', '평촌', '중동', '산본',
    // 광역시 핵심지
    '해운대', '수영구',
  ],
  sectionHeader: '🔵 GS건설 & 자이 위클리',
  minSelfKeywordOccurrences: 5,
  minCompetitorCompanies: 3,
}

// ─────────────────────────────────────────────────────────────────────────
// 다른 건설사 프로필 (멀티 발송 확장 대비 — 키워드 세트만 정의)
// ─────────────────────────────────────────────────────────────────────────
export const HYUNDAI_PROFILE: CompanyProfile = {
  key: 'hyundai',
  displayName: '현대건설',
  focusKeywords: [
    '현대건설', '힐스테이트', '디에이치', 'THE H', 'Hillstate',
    '현대엔지니어링', '윤영준', '현대건설 대표',
  ],
  competitorKeywords: [
    'GS건설', '자이', 'Xi', '삼성물산', '래미안',
    '대우건설', '푸르지오', 'DL이앤씨', '아크로', 'e편한세상',
    '포스코이앤씨', '더샵', '롯데건설', '롯데캐슬',
    'SK에코플랜트', 'HDC현대산업개발', '아이파크',
  ],
  watchRegions: GS_PROFILE.watchRegions,
  sectionHeader: '🟢 현대건설 & 힐스테이트 위클리',
  minSelfKeywordOccurrences: 5,
  minCompetitorCompanies: 3,
}

export const SAMSUNG_PROFILE: CompanyProfile = {
  key: 'samsung',
  displayName: '삼성물산',
  focusKeywords: [
    '삼성물산', '삼성물산 건설부문', '래미안', 'RAEMIAN',
    '오세철', '삼성물산 대표',
  ],
  competitorKeywords: [
    'GS건설', '자이', '현대건설', '힐스테이트', '디에이치',
    '대우건설', '푸르지오', 'DL이앤씨', '아크로',
    '포스코이앤씨', '더샵', '롯데건설', '롯데캐슬',
    'SK에코플랜트', 'HDC현대산업개발', '아이파크',
  ],
  watchRegions: GS_PROFILE.watchRegions,
  sectionHeader: '🔴 삼성물산 & 래미안 위클리',
  minSelfKeywordOccurrences: 5,
  minCompetitorCompanies: 3,
}

export const DAEWOO_PROFILE: CompanyProfile = {
  key: 'daewoo',
  displayName: '대우건설',
  focusKeywords: [
    '대우건설', '푸르지오', '써밋', 'SUMMIT', 'PRUGIO',
    '백정완', '대우건설 대표',
  ],
  competitorKeywords: [
    'GS건설', '자이', '현대건설', '힐스테이트', '디에이치',
    '삼성물산', '래미안', 'DL이앤씨', '아크로',
    '포스코이앤씨', '더샵', '롯데건설', '롯데캐슬',
    'SK에코플랜트', 'HDC현대산업개발', '아이파크',
  ],
  watchRegions: GS_PROFILE.watchRegions,
  sectionHeader: '🟣 대우건설 & 푸르지오 위클리',
  minSelfKeywordOccurrences: 5,
  minCompetitorCompanies: 3,
}

export const DL_PROFILE: CompanyProfile = {
  key: 'dl',
  displayName: 'DL이앤씨',
  focusKeywords: [
    'DL이앤씨', 'DL E&C', 'e편한세상', '아크로', 'ACRO',
    '마창민', 'DL이앤씨 대표',
  ],
  competitorKeywords: [
    'GS건설', '자이', '현대건설', '힐스테이트', '삼성물산', '래미안',
    '대우건설', '푸르지오', '포스코이앤씨', '더샵',
    '롯데건설', '롯데캐슬', 'SK에코플랜트', 'HDC현대산업개발', '아이파크',
  ],
  watchRegions: GS_PROFILE.watchRegions,
  sectionHeader: '🟠 DL이앤씨 & 아크로/e편한세상 위클리',
  minSelfKeywordOccurrences: 5,
  minCompetitorCompanies: 3,
}

// ─────────────────────────────────────────────────────────────────────────
// 프로필 레지스트리 + 조회 함수
// ─────────────────────────────────────────────────────────────────────────
export const COMPANY_PROFILES: Record<string, CompanyProfile> = {
  gs: GS_PROFILE,
  hyundai: HYUNDAI_PROFILE,
  samsung: SAMSUNG_PROFILE,
  daewoo: DAEWOO_PROFILE,
  dl: DL_PROFILE,
}

/** 프로필 키로 조회. 키가 없거나 매칭 안 되면 null (일반본 사용) */
export function getCompanyProfile(key: string | null | undefined): CompanyProfile | null {
  if (!key) return null
  return COMPANY_PROFILES[key] || null
}

/** subscribers row에 저장된 JSON 컬럼들을 안전 파싱하여 프로필을 오버라이드 */
export function profileFromSubscriberRow(row: {
  company?: string | null
  company_profile?: string | null
  focus_keywords?: string | null
  competitor_keywords?: string | null
  watch_regions?: string | null
}): CompanyProfile | null {
  const base = getCompanyProfile(row.company_profile)
  if (!base) return null
  // 오버라이드 JSON 파싱 (실패 시 base 값 유지)
  const parseArr = (s: string | null | undefined): string[] | null => {
    if (!s) return null
    try { const v = JSON.parse(s); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : null }
    catch { return null }
  }
  return {
    ...base,
    displayName: row.company || base.displayName,
    focusKeywords: parseArr(row.focus_keywords) || base.focusKeywords,
    competitorKeywords: parseArr(row.competitor_keywords) || base.competitorKeywords,
    watchRegions: parseArr(row.watch_regions) || base.watchRegions,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// LLM 가드레일 블록 빌더 — 회사별 동적 생성
// ─────────────────────────────────────────────────────────────────────────
export function buildCustomGuardrail(profile: CompanyProfile): string {
  return `
[수신자 맞춤화 — ${profile.displayName}용]

본 호의 수신자는 ${profile.displayName}입니다. 다음 원칙으로 콘텐츠를 구성하세요.

1. ${profile.displayName} 관련 정보는 모두 포함
   - 키워드: ${profile.focusKeywords.slice(0, 12).map(k => `"${k}"`).join(', ')}
   - 수주, 분양, 실적, 인사, 기술 발표, 사회공헌 등 빠짐없이.
   - 단, 부정적 이슈(사고, 소송, 하자 등)도 객관적으로 다룰 것. (숨기면 신뢰 상실)

2. 경쟁사 정보는 ${profile.displayName} 관점에서 중요한 것 위주
   - 키워드: ${profile.competitorKeywords.slice(0, 12).map(k => `"${k}"`).join(', ')}
   - 수주 동향, 시공사 선정 결과, 신기술 발표, 인사·조직 개편, 재무 이슈 우선.

3. 관심 정비구역 우선 노출
   - 핵심지: ${profile.watchRegions.slice(0, 14).join(', ')}
   - ${profile.displayName} 수주/입찰 참여 구역은 가장 위에 배치.
   - 위 지역의 정비구역 소식은 다른 지역보다 우선 노출.

4. 분양 정보는 강남권/수도권 핵심지 우선
   - ${profile.displayName} 자사 브랜드 분양은 무조건 포함.
   - 경쟁 브랜드 분양 단지도 동급 입지면 포함.

5. 섹션별 ${profile.displayName} 정보 자연스러운 배치
   - [TOP 5 이슈] 그 주의 진짜 핵심 이슈 위주 (억지 끼워넣기 금지).
     동급 중요도 이슈가 둘일 때는 ${profile.displayName} 관련 이슈 우선.
   - [도시정비 동향] ${profile.displayName} 수주/입찰 구역을 가장 위에 배치.
     경쟁사 수주 소식도 충실히 다룰 것 (다음 입찰 준비에 필요).
   - [건설사 동향] ${profile.displayName} 단독 항목 1~2건 필수.
     그 외 경쟁사 동향 균형 있게.
   - [분양·청약] 자사 브랜드 분양 모두 포함, 강남·한강변 분양은 브랜드 무관 포함.

6. 절대 하지 말 것
   - "${profile.displayName}이 최고" 류의 과장 표현
   - 경쟁사 깎아내리기
   - 부정적 사실 숨기기
   - 광고성 톤 (사실 위주 중립적 정보 매체 톤 유지)

7. ${profile.displayName} 전용 섹션 신설: ${profile.sectionHeader}
   메일 본문 중간(도시정비 다음, 정책 앞)에 별도 박스로 배치:
   - 이번 주 ${profile.displayName} 관련 모든 뉴스 5~10건 요약
   - 자사 브랜드 분양 현황
   - 경쟁사 비교 1줄 코멘트 (예: "현대건설 압구정3구역 수주 성공, ${profile.displayName}은 ○○구역 입찰 준비 중")
   - 다음 주 ${profile.displayName} 관련 주목 일정

---
`
}

// ─────────────────────────────────────────────────────────────────────────
// 기사 점수 시스템 — scoreArticle()
//   base = 100
//   + focusKeywords 매칭: +50
//   + competitorKeywords 매칭: +20
//   + watchRegions 매칭: +30
//   + 강남권/한강변 키워드: +20
//   + 시공사 선정/입찰 관련: +25
//   + 정비구역명 명시(○○구역 패턴): +15
//   + 자사 분양(자이 등): +30
//   + 강남권 분양 (자사 외): +15
//   - 정치/광고-매체: 사전 단계에서 제외(scoreArticle은 호출되지 않음)
// ─────────────────────────────────────────────────────────────────────────

export interface ScoreInput {
  title: string
  description?: string | null
  category?: string | null
}

export interface ScoreBreakdown {
  total: number
  base: number
  focus: number
  competitor: number
  region: number
  primeRegion: number
  contractor: number
  districtNamed: number
  selfPresale: number
  primePresale: number
  matched: {
    focus: string[]
    competitor: string[]
    region: string[]
  }
}

const PRIME_REGION_HINTS = ['강남', '강남구', '서초', '서초구', '송파', '용산', '여의도', '한강', '압구정', '반포', '한남']
const CONTRACTOR_KW = ['시공사 선정', '시공사선정', '수주', '입찰', '컨소시엄', '재입찰', '우선협상', '본계약', '시공권']
const PRESALE_KW = ['분양', '청약', '계약금', '중도금', '입주자모집공고', '특별공급']
const DISTRICT_RE = /[가-힣A-Za-z0-9]+(?:\d+)?\s*(?:구역|정비구역|재개발|재건축|뉴타운|모아타운)/

export function scoreArticle(article: ScoreInput, profile: CompanyProfile | null): ScoreBreakdown {
  const text = `${article.title || ''} ${(article.description || '').slice(0, 300)}`

  const matchedFocus: string[] = profile
    ? profile.focusKeywords.filter(k => text.includes(k))
    : []
  const matchedCompetitor: string[] = profile
    ? profile.competitorKeywords.filter(k => text.includes(k))
    : []
  const matchedRegion: string[] = profile
    ? profile.watchRegions.filter(r => text.includes(r))
    : []

  const base = 100
  const focus = matchedFocus.length > 0 ? 50 : 0
  const competitor = matchedCompetitor.length > 0 ? 20 : 0
  const region = matchedRegion.length > 0 ? 30 : 0
  const primeRegion = PRIME_REGION_HINTS.some(h => text.includes(h)) ? 20 : 0
  const contractor = CONTRACTOR_KW.some(k => text.includes(k)) ? 25 : 0
  const districtNamed = DISTRICT_RE.test(text) ? 15 : 0

  // 자사 분양(브랜드 키워드 + 분양 키워드 동시 매칭)
  const isPresale = PRESALE_KW.some(k => text.includes(k))
  const selfPresale = (isPresale && matchedFocus.length > 0) ? 30 : 0
  // 강남권 분양 (자사 외)
  const primePresale = (isPresale && primeRegion > 0 && selfPresale === 0) ? 15 : 0

  const total = base + focus + competitor + region + primeRegion + contractor + districtNamed + selfPresale + primePresale

  return {
    total,
    base, focus, competitor, region, primeRegion, contractor, districtNamed, selfPresale, primePresale,
    matched: { focus: matchedFocus, competitor: matchedCompetitor, region: matchedRegion },
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 회사별 검증 체크리스트 — verifyCompanySummary()
//   GS건설용 사양:
//   □ GS건설/자이 키워드가 본문에 최소 5회 이상 등장
//   □ "GS건설 & 자이 위클리" 섹션이 존재하고 비어있지 않음
//   □ 주요 경쟁사 중 최소 3개사 이상 언급
//   □ 강남권/한강변 정비구역 소식 포함
//   □ 과장된 표현 없음 (최고/독보적/압도적/단연/유일)
//   □ (별도 입력) GS건설 관련 부정적 사실 누락 여부
// ─────────────────────────────────────────────────────────────────────────

const HYPE_TERMS = ['최고', '독보적', '압도적', '단연', '유일무이', '타의 추종', '독점적']

export interface CompanyVerificationResult {
  passed: boolean
  warnings: string[]
  stats: {
    selfKeywordCount: number          // 자사 키워드 본문 등장 횟수
    selfKeywordsMatched: string[]
    competitorCompaniesMentioned: number
    competitorsMatched: string[]
    customSectionPresent: boolean
    customSectionLength: number       // 섹션 본문 글자 수
    watchRegionMentioned: boolean
    watchRegionsMatched: string[]
    hypeTermsFound: string[]
  }
}

/** 본문에서 회사 전용 섹션 내용을 잘라내어 반환 (헤더 매칭 후 다음 ## 까지) */
function extractCustomSection(content: string, sectionHeader: string): string {
  if (!content || !sectionHeader) return ''
  // 헤더의 이모지 제거 후 핵심 문구로 정규식 매칭
  const headerKey = sectionHeader.replace(/[^\u3131-\uD79D\w]/g, '').slice(-12) // "GS건설&자이위클리" 등
  if (!headerKey) return ''
  const re = new RegExp(`##[^\\n]*${headerKey.split('').slice(0, 6).join('[\\s\\S]{0,5}')}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i')
  const m = content.match(re)
  if (!m) {
    // fallback: 정확한 헤더 텍스트 부분 매칭
    const idx = content.indexOf(sectionHeader.replace(/^[^\u3131-\uD79D\w]+/, ''))
    if (idx < 0) return ''
    const tail = content.slice(idx)
    const next = tail.search(/\n##\s/)
    return next > 0 ? tail.slice(0, next) : tail
  }
  return m[1] || ''
}

export function verifyCompanySummary(
  content: string,
  profile: CompanyProfile,
): CompanyVerificationResult {
  const text = content || ''

  // (1) 자사 키워드 등장 횟수 (전체 본문 기준, 중복 카운트)
  const selfKeywordsMatched: string[] = []
  let selfKeywordCount = 0
  for (const k of profile.focusKeywords) {
    const m = text.match(new RegExp(escapeReg(k), 'g'))
    if (m && m.length > 0) {
      selfKeywordsMatched.push(`${k}×${m.length}`)
      selfKeywordCount += m.length
    }
  }

  // (2) 경쟁사 매칭 — "회사명"이 본문에 1번이라도 등장하면 카운트
  //   주요 경쟁사로 한정 (브랜드 키워드는 회사명과 별도 카운트하지 않음)
  const MAIN_COMPETITORS = ['현대건설', '삼성물산', '대우건설', 'DL이앤씨', '포스코이앤씨',
    '롯데건설', 'SK에코플랜트', 'HDC현대산업개발', '현대엔지니어링']
  const competitorsMatched = MAIN_COMPETITORS.filter(c => text.includes(c))
  const competitorCompaniesMentioned = competitorsMatched.length

  // (3) 전용 섹션 존재 확인
  const sectionBody = extractCustomSection(text, profile.sectionHeader)
  const customSectionPresent = sectionBody.trim().length > 0
  const customSectionLength = sectionBody.trim().length

  // (4) 강남권/한강변 정비구역 매칭
  const watchRegionsMatched = profile.watchRegions.filter(r => text.includes(r))
  const watchRegionMentioned = watchRegionsMatched.length > 0

  // (5) 과장 표현
  const hypeTermsFound = HYPE_TERMS.filter(h => text.includes(h))

  // 검증 결과 — 사양 그대로
  const warnings: string[] = []
  if (selfKeywordCount < profile.minSelfKeywordOccurrences) {
    warnings.push(
      `자사 키워드(${profile.displayName}/브랜드) 본문 등장 ${selfKeywordCount}회 < 최소 ${profile.minSelfKeywordOccurrences}회`
    )
  }
  if (!customSectionPresent) {
    warnings.push(`"${profile.sectionHeader}" 섹션이 본문에 없거나 비어있음`)
  } else if (customSectionLength < 100) {
    warnings.push(`"${profile.sectionHeader}" 섹션 내용이 너무 짧음 (${customSectionLength}자)`)
  }
  if (competitorCompaniesMentioned < profile.minCompetitorCompanies) {
    warnings.push(
      `주요 경쟁사 ${competitorCompaniesMentioned}개 < 최소 ${profile.minCompetitorCompanies}개 언급 (현재: ${competitorsMatched.join(', ') || '없음'})`
    )
  }
  if (!watchRegionMentioned) {
    warnings.push(`관심 정비구역(강남권/한강변 등) 미언급`)
  }
  if (hypeTermsFound.length > 0) {
    warnings.push(`과장된 표현 발견: ${hypeTermsFound.join(', ')}`)
  }
  // ※ "부정적 사실 누락" 자동 검증 불가 → 운영 단계에서 수동 체크 항목으로 남김

  return {
    passed: warnings.length === 0,
    warnings,
    stats: {
      selfKeywordCount,
      selfKeywordsMatched,
      competitorCompaniesMentioned,
      competitorsMatched,
      customSectionPresent,
      customSectionLength,
      watchRegionMentioned,
      watchRegionsMatched,
      hypeTermsFound,
    },
  }
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
