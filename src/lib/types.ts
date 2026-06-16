// Cloudflare 바인딩 타입
// 주의: R2는 자동 배포 시스템의 R2 버킷 자동 생성 이슈로 임시 옵셔널 처리됨.
// Cloudflare 대시보드에서 수동으로 R2 binding을 연결하면 정상 동작.
export type Bindings = {
  DB: D1Database
  R2?: R2Bucket
  TIMEZONE: string
  RESEND_API_KEY?: string
}

export type AppVariables = {
  adminId?: number
  adminUsername?: string
}

// 세부 카테고리 (수집 단위)
// - 부동산 계열: 분양 / 청약 / 정책 / 건설
// - 도시정비 계열: 재건축 / 도시정비
// - 광고/매체 계열 (NEW): 옥외광고 / 디지털광고 / 광고산업 / 미디어 / 광고규제
// - 기술: AI
export type Category =
  | '분양' | '청약' | '재건축' | '정책' | '건설' | '도시정비'
  | '옥외광고' | '디지털광고' | '광고산업' | '미디어' | '광고규제'
  | 'AI'

// 그룹 카테고리 (UI 필터 단위)
export type CategoryGroup = '부동산' | '도시정비' | '광고/매체' | 'AI' | '기타'

export const CATEGORY_GROUP_MAP: Record<Category, CategoryGroup> = {
  // 부동산
  '분양': '부동산',
  '청약': '부동산',
  '정책': '부동산',
  '건설': '부동산',
  // 도시정비
  '재건축': '도시정비',
  '도시정비': '도시정비',
  // 광고/매체 (NEW)
  '옥외광고': '광고/매체',
  '디지털광고': '광고/매체',
  '광고산업': '광고/매체',
  '미디어': '광고/매체',
  '광고규제': '광고/매체',
  // AI
  'AI': 'AI'
}

export const CATEGORY_GROUPS: CategoryGroup[] = ['부동산', '도시정비', '광고/매체', 'AI', '기타']

// 카테고리 그룹별 아이콘/색상 (UI 통일)
export const CATEGORY_GROUP_META: Record<CategoryGroup, { icon: string; color: string }> = {
  '부동산':   { icon: '🏢', color: '#3498db' },
  '도시정비': { icon: '🏗️', color: '#e67e22' },
  '광고/매체': { icon: '📺', color: '#9b59b6' },
  'AI':       { icon: '🤖', color: '#16a085' },
  '기타':     { icon: '📌', color: '#7f8c8d' },
}

// 메인 수집 카테고리 (네이버 검색 1차 호출)
export const CATEGORIES: { key: Category; query: string }[] = [
  { key: '분양', query: '아파트 분양' },
  { key: '청약', query: '아파트 청약' },
  { key: '재건축', query: '재건축 재개발' },
  { key: '정책', query: '부동산 정책' },
  { key: '건설', query: '건설사' },
  // 도시정비
  { key: '도시정비', query: '도시정비 정비사업 조합설립 시공사선정 관리처분 신통기획 모아타운 공공재개발 가로주택정비사업' },
  // AI
  { key: 'AI', query: 'AI 부동산 프롭테크' },
  // 광고/매체 (NEW) — 대표 키워드만 메인 호출, 상세 키워드는 EXTRA에서 분리 수집
  { key: '옥외광고',   query: '옥외광고 OOH DOOH 빌보드 디지털사이니지' },
  { key: '디지털광고', query: '디지털광고 퍼포먼스마케팅 프로그래매틱 CTV광고 리테일미디어' },
  { key: '광고산업',   query: '광고대행사 광고시장 광고비 제일기획 이노션' },
  { key: '미디어',     query: '방송광고 매체사 미디어렙 코바코 넷플릭스광고' },
  { key: '광고규제',   query: '방송통신위원회 광고 표시광고법 광고심의' },
]

// 도시정비 추가 키워드 (검색 보강용 — 분리 호출하여 더 풍부한 수집)
export const URBAN_RENEWAL_EXTRA_QUERIES = [
  '리모델링 아파트',
  '소규모재건축',
  '도심공공주택복합사업',
  '역세권 개발'
]

// 광고/매체 카테고리별 추가 검색어 (분리 호출하여 풍부한 수집)
// - 메인 호출 키워드 외 보강용 키워드를 카테고리별로 정의
export const AD_MEDIA_EXTRA_QUERIES: Record<Category, string[]> = {
  '분양': [], '청약': [], '재건축': [], '정책': [], '건설': [], '도시정비': [], 'AI': [],
  '옥외광고': [
    '버스쉘터 광고', '지하철 광고', '택시 광고', '엘리베이터 광고',
    'LED 전광판', '미디어월 미디어파사드',
    '옥외광고법 자유표시구역',
    '코엑스 SM타운', '강남 미디어폴', '명동 옥외광고',
  ],
  '디지털광고': [
    'OTT 광고 유튜브 광고', '틱톡 광고 인스타그램 광고',
    '커머스미디어 쇼퍼블 광고',
    '생성형 AI 광고', '메타버스 광고 AR 광고',
  ],
  '광고산업': [
    'HS애드 대홍기획 TBWA 농심기획',
    '칸 라이언즈 클리오',
    '대한민국광고대상 애드페스트',
    '광고 캠페인 브랜드 마케팅 IMC',
  ],
  '미디어': [
    '한국방송광고진흥공사 코바코',
    '디즈니플러스 광고 티빙 광고 쿠팡플레이 광고',
    '카카오 광고 네이버 광고',
    '신문광고 방송광고',
  ],
  '광고규제': [
    '공정거래위원회 광고',
    '의료광고 규제 금융광고 규제',
    '한국광고자율심의기구',
  ],
}

// 광고성/홍보성 콘텐츠 필터링용 키워드 (제목에 포함되면 수집 제외)
// - 광고대행 모집 / 단가 안내 / 견적 / 모집 공고 등 자기참조성 콘텐츠 제거
export const AD_SPAM_PATTERNS = [
  /광고\s*대행\s*모집/i,
  /광고\s*단가\s*안내/i,
  /광고\s*문의/i,
  /광고\s*견적/i,
  /광고\s*제휴\s*문의/i,
  /(보도자료|언론보도)\s*광고/i,
  /(배너|기사형)\s*광고\s*모집/i,
  /협찬\s*문의/i,
]

export const CONTENT_CATEGORIES = ['신규 상품', '이벤트/프로모션', '공지사항', '회사 소식']

export interface NewsItem {
  id?: number
  title: string
  description: string
  link: string
  source: string
  pub_date: string
  category: Category
  collection_date: string
}

export interface Subscriber {
  id: number
  email: string
  name: string | null
  active: number
  unsubscribe_token: string
  created_at: string
}

export interface CompanyContent {
  id: number
  title: string
  body: string
  category: string
  image_url: string | null
  external_link: string | null
  start_date: string | null
  end_date: string | null
  show_in_email: number
  is_pinned: number
  status: string
  view_count: number
  click_count: number
  created_at: string
  updated_at: string
}

// ──────────────────────────────────────────────────────────────────────
// 위클리(Weekly) 도메인 타입
// ──────────────────────────────────────────────────────────────────────

// 위클리 호 발행 상태
export type WeeklyStatus = 'draft' | 'ready' | 'sent'

// 위클리 호 본문 (weekly_summaries)
export interface WeeklySummary {
  id: number
  week_start_date: string   // YYYY-MM-DD (월요일 KST)
  week_end_date: string     // YYYY-MM-DD (일요일 KST)
  vol_no: number            // VOL.번호
  issue_date: string        // YYYY-MM-DD (발행일 = 월요일 KST)
  market_oneliner: string | null  // 이번 주 시장 한 줄 요약
  content: string           // 본문 (Markdown/HTML)
  article_count: number
  status: WeeklyStatus
  created_at: string
  updated_at: string
}

// 위클리 TOP 3 핵심 이슈 (weekly_top_news)
export interface WeeklyTopNews {
  id: number
  week_start_date: string
  rank: number              // 1, 2, 3
  news_id: number | null
  title: string
  summary: string | null
  link: string | null
  source: string | null
  category: string | null
  created_at: string
}

// 위클리 이벤트 섹션
export type WeeklyEventSection = 'this_week' | 'next_week'

// 위클리 이벤트 타입 (캘린더 카테고리)
export type WeeklyEventType =
  | 'subscription'  // 청약 일정
  | 'modelhouse'    // 견본주택 오픈
  | 'bid'           // 입찰 일정
  | 'policy'        // 정책 발표
  | 'rate'          // 기준금리
  | 'supply'        // 신규 공급
  | 'announcement'  // 건설사 주요 발표
  | 'other'

export const WEEKLY_EVENT_TYPE_LABELS: Record<WeeklyEventType, { label: string; icon: string }> = {
  subscription:  { label: '청약',       icon: '📝' },
  modelhouse:    { label: '견본주택',   icon: '🏠' },
  bid:           { label: '입찰',       icon: '📋' },
  policy:        { label: '정책 발표',  icon: '🏛️' },
  rate:          { label: '기준금리',   icon: '💰' },
  supply:        { label: '신규 공급',  icon: '🏗️' },
  announcement: { label: '건설사 발표', icon: '📢' },
  other:         { label: '기타',       icon: '📌' },
}

// 위클리 이벤트 (weekly_events)
export interface WeeklyEvent {
  id: number
  week_start_date: string
  section: WeeklyEventSection
  event_type: WeeklyEventType
  event_date: string | null
  title: string
  description: string | null
  category: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

// 아카이브 카드 태그 (weekly_summary_tags)
// 추천 태그 풀: PF / 청약 / 정책 / 브랜드 / 금리 / 입찰 / 공급
export const WEEKLY_TAG_POOL = ['PF', '청약', '정책', '브랜드', '금리', '입찰', '공급'] as const
export type WeeklyTag = typeof WEEKLY_TAG_POOL[number] | string  // 자유 입력 허용

export interface WeeklySummaryTag {
  id: number
  week_start_date: string
  tag: string
  created_at: string
}

// 발행 메타 (UI용 통합 객체)
export interface WeeklyIssueMeta {
  weekStart: string         // YYYY-MM-DD
  weekEnd: string           // YYYY-MM-DD
  issueDate: string         // YYYY-MM-DD (발행일)
  volNo: number
  weekRangeKo: string       // "5/26(월) ~ 5/30(일)"
  issueLabelKo: string      // "2026년 5월 4주차"
  nextIssueKo: string       // "6월 2일(월) 오전 7시"
}
