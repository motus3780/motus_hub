// 언론사명 매핑 (도메인 → 한글 언론사명)
// - 기본 매핑은 코드 내 상수로 관리
// - 관리자 페이지에서 추가/수정한 매핑은 settings 테이블에 JSON으로 저장 (key: media_mapping_custom)
// - 우선순위: 커스텀 매핑 > 기본 매핑 > 도메인 메인 부분만 표시

import { getSetting, setSetting } from './settings'

const MEDIA_MAPPING_KEY = 'media_mapping_custom'

// 기본 언론사 매핑 테이블
export const DEFAULT_MEDIA_MAPPINGS: Record<string, string> = {
  // 종합 일간지
  'joongang.co.kr': '중앙일보',
  'mk.co.kr': '매일경제',
  'hankyung.com': '한국경제',
  'chosun.com': '조선일보',
  'donga.com': '동아일보',
  'hani.co.kr': '한겨레',
  'khan.co.kr': '경향신문',
  'munhwa.com': '문화일보',
  'segye.com': '세계일보',
  'kmib.co.kr': '국민일보',
  'seoul.co.kr': '서울신문',
  'hankookilbo.com': '한국일보',

  // 경제지
  'sedaily.com': '서울경제',
  'edaily.co.kr': '이데일리',
  'fnnews.com': '파이낸셜뉴스',
  'mt.co.kr': '머니투데이',
  'asiae.co.kr': '아시아경제',
  'heraldcorp.com': '헤럴드경제',
  'biz.heraldcorp.com': '헤럴드경제',
  'businesspost.co.kr': '비즈니스포스트',
  'thebell.co.kr': '더벨',

  // 통신사
  'yna.co.kr': '연합뉴스',
  'yonhapnews.co.kr': '연합뉴스',
  'news1.kr': '뉴스1',
  'newsis.com': '뉴시스',

  // 방송
  'kbs.co.kr': 'KBS',
  'imbc.com': 'MBC',
  'sbs.co.kr': 'SBS',
  'ytn.co.kr': 'YTN',
  'jtbc.co.kr': 'JTBC',
  'jtbc.joins.com': 'JTBC',
  'tvchosun.com': 'TV조선',
  'channela.com': '채널A',
  'mbn.co.kr': 'MBN',

  // IT/테크
  'etnews.com': '전자신문',
  'zdnet.co.kr': 'ZDNet Korea',
  'bloter.net': '블로터',
  'venturesquare.net': '벤처스퀘어',
  'ddaily.co.kr': '디지털데일리',
  'dt.co.kr': '디지털타임스',
  'itworld.co.kr': 'ITWorld',
  'aitimes.com': 'AI타임스',
  'aitimes.kr': 'AI타임스',

  // 부동산 / 건설 전문지
  'land.naver.com': '네이버 부동산',
  'housingherald.co.kr': '하우징헤럴드',
  'rebuilding.co.kr': '도시개발신문',
  'arunews.com': '한국주택경제신문',
  'jbsnews.kr': '정비사업신문',
  'cnews.co.kr': '건설경제',
  'ikld.kr': '국토일보',
  'reb.co.kr': '한국부동산원',
  'r114.com': '부동산114',
  'kab.co.kr': '한국감정원',
  'mk-rich.mk.co.kr': '매경부동산',
  'realestate.daum.net': '다음 부동산',
  'realty.chosun.com': '땅집GO',

  // 기타 일간/지역
  'ohmynews.com': '오마이뉴스',
  'pressian.com': '프레시안',
  'mediatoday.co.kr': '미디어오늘',
  'nocutnews.co.kr': '노컷뉴스',
  'breaknews.com': '브레이크뉴스',
  'newdaily.co.kr': '뉴데일리',
  'no-smok.net': '노스모크',
  'naeil.com': '내일신문',
  'busan.com': '부산일보',
  'kookje.co.kr': '국제신문',
  'imaeil.com': '매일신문',
  'inews24.com': '아이뉴스24',

  // 광고/매체 전문지
  'ad.co.kr': '광고정보센터',
  'thepr.co.kr': 'THE PR',
  // 'mediatoday.co.kr': '미디어오늘',  // 이미 위에 등록됨
  'adic.or.kr': '한국광고총연합회',
  'kobaco.co.kr': '코바코',
  'mkmedia.kr': '미디어케이',
  'adsignage.co.kr': '옥외광고신문',
  'adweek.co.kr': '애드위크코리아',
  'brandbrief.co.kr': '브랜드브리프',
  'kpr.co.kr': '케이피알',
}

/**
 * 매핑 테이블 로드 (기본 + 사용자 커스텀 병합)
 */
export async function loadMediaMappings(db: D1Database): Promise<Record<string, string>> {
  const customJson = await getSetting(db, MEDIA_MAPPING_KEY)
  let custom: Record<string, string> = {}
  if (customJson) {
    try { custom = JSON.parse(customJson) } catch {}
  }
  // 커스텀이 기본을 덮어씀
  return { ...DEFAULT_MEDIA_MAPPINGS, ...custom }
}

/**
 * 도메인을 언론사명으로 변환
 */
export function resolveMediaName(domain: string, mappings: Record<string, string>): string {
  if (!domain || domain === '-') return '-'
  const d = domain.toLowerCase().replace(/^www\./, '')
  if (mappings[d]) return mappings[d]

  // 서브도메인 매칭 (예: news.joins.com → joins.com)
  const parts = d.split('.')
  for (let i = 1; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.')
    if (mappings[candidate]) return mappings[candidate]
  }

  // 매핑이 없으면 도메인 메인 부분만 표시 (예: breaknews.com → breaknews)
  const main = parts[0]
  return main || d
}

/**
 * 커스텀 매핑 저장
 */
export async function saveMediaMappings(db: D1Database, custom: Record<string, string>): Promise<void> {
  // 키 정규화 (소문자, www. 제거)
  const normalized: Record<string, string> = {}
  for (const [k, v] of Object.entries(custom)) {
    const key = (k || '').toLowerCase().trim().replace(/^www\./, '').replace(/^https?:\/\//, '')
    const val = (v || '').trim()
    if (key && val) normalized[key] = val
  }
  await setSetting(db, MEDIA_MAPPING_KEY, JSON.stringify(normalized))
}

/**
 * 커스텀 매핑만 로드 (관리자 화면 표시용)
 */
export async function loadCustomMappings(db: D1Database): Promise<Record<string, string>> {
  const customJson = await getSetting(db, MEDIA_MAPPING_KEY)
  if (!customJson) return {}
  try { return JSON.parse(customJson) } catch { return {} }
}
