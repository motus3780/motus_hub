// 뉴스레터 이메일 HTML 템플릿 (일간 + 위클리)

import {
  type CompanyContent, type NewsItem,
  type WeeklySummary, type WeeklyTopNews,
  CATEGORY_GROUP_MAP, CATEGORY_GROUP_META
} from '../lib/types'
import { escapeHtml, formatKoreanDate, markdownToHtml } from '../lib/utils'

export interface EmailTemplateData {
  date: string
  summaryMarkdown: string
  totalArticles: number
  newsCounts: Record<string, number>
  topNews: NewsItem[]
  companyContents: CompanyContent[]
  siteUrl: string
  unsubscribeToken: string
  logoUrl?: string | null
  senderName: string
  /**
   * 운영자가 위클리 이미지 관리에서 등록한 카테고리 대표 이미지
   * key: 'urban' | 'sale' | 'builder' | 'policy' | 'media' | 'company'
   * 데일리 메일에서는 "오늘의 카테고리별 헤드라인" 섹션의 그룹 헤더 이미지로 사용
   */
  sectionImages?: Record<string, string>
}

// ────────────────────────────────────────────────────────────────────
// CategoryGroup → sectionImages 키 매핑
// (위클리/데일리 공통: 위클리 이미지 관리 페이지에 등록된 6개 키를 재사용)
// ────────────────────────────────────────────────────────────────────
type DailySectionKey = 'urban' | 'sale' | 'builder' | 'policy' | 'media' | 'company'

const CATEGORY_TO_SECTION_KEY: Record<string, DailySectionKey> = {
  // 부동산 그룹 → sale(분양·청약) 또는 policy(정책)
  '분양': 'sale',
  '청약': 'sale',
  '정책': 'policy',
  '건설': 'builder',
  // 도시정비 그룹 → urban
  '재건축': 'urban',
  '도시정비': 'urban',
  // 광고/매체 그룹 → media
  '옥외광고': 'media',
  '디지털광고': 'media',
  '광고산업': 'media',
  '미디어': 'media',
  '광고규제': 'media',
  // AI → builder(임시 매핑) — 데일리에는 AI 그룹용 대표 이미지가 별도 없음
  'AI': 'builder',
}

const SECTION_KEY_LABEL: Record<DailySectionKey, { icon: string; label: string; color: string }> = {
  urban:   { icon: '🏗️', label: '도시정비',     color: '#e67e22' },
  sale:    { icon: '🏢', label: '분양·청약',     color: '#3498db' },
  builder: { icon: '🔨', label: '건설사·기술',   color: '#1abc9c' },
  policy:  { icon: '📊', label: '정책·시장',     color: '#34495e' },
  media:   { icon: '📺', label: '광고·매체',     color: '#9b59b6' },
  company: { icon: '🔵', label: '기업 동향',     color: '#2980b9' },
}

// 절대 URL 보정 (메일 클라이언트에서 상대경로 무효 → 절대 URL 필요)
function toAbsoluteUrl(u: string | undefined | null, siteUrl: string): string | undefined {
  if (!u) return undefined
  if (/^https?:\/\//i.test(u)) return u
  if (u.startsWith('/')) return siteUrl.replace(/\/$/, '') + u
  return u
}

// H2 헤딩 텍스트 → sectionKey 추정 (이모지/공백/구두점 무시하고 키워드 매칭)
// "## 🏢 분양·청약 동향", "## 도시정비 동향" 등을 인식
export function inferSectionKeyFromHeading(heading: string): DailySectionKey | null {
  const h = (heading || '').toLowerCase()
  // 우선순위: 명시적 키워드 → 그룹 매핑
  if (/도시\s*정비|재건축|재개발|정비\s*사업/.test(h)) return 'urban'
  if (/분양|청약/.test(h)) return 'sale'
  if (/건설사|시공사|건설\s*기술|건설사·기술|건설사\s*동향/.test(h)) return 'builder'
  if (/정책|시장|규제|금리|세제/.test(h)) return 'policy'
  if (/광고|매체|미디어|옥외|디지털\s*광고/.test(h)) return 'media'
  if (/회사|기업|자사|모투스/.test(h)) return 'company'
  return null
}

/**
 * markdown으로 렌더링된 HTML에서 <h2>...</h2> 태그 직후에 카테고리 대표 이미지를 삽입한다.
 * 이메일/웹 공통으로 사용 가능.
 *
 * @param html       markdownToHtml 결과 HTML
 * @param sectionImages { urban:'/r2/...', sale:'/r2/...', ... }
 * @param siteUrl    절대 URL 보정용 (메일은 필수, 웹은 비워두면 상대경로 유지)
 * @param style      img 스타일 ('email' | 'web')
 */
export function injectSectionImagesIntoHtml(
  html: string,
  sectionImages: Record<string, string> | undefined,
  siteUrl: string,
  style: 'email' | 'web' = 'email',
): string {
  if (!html || !sectionImages || Object.keys(sectionImages).length === 0) return html
  // <h2 ...>...</h2> 를 모두 찾아서 그 뒤에 이미지 <p> 삽입
  return html.replace(/<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/gi, (match, _attrs, inner) => {
    // 텍스트만 추출
    const text = (inner || '').replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim()
    const sk = inferSectionKeyFromHeading(text)
    if (!sk) return match
    const rawImg = sectionImages[sk]
    if (!rawImg) return match
    const absImg = style === 'email'
      ? (toAbsoluteUrl(rawImg, siteUrl) || rawImg)
      : rawImg // 웹은 상대경로 그대로 (같은 도메인)
    const meta = SECTION_KEY_LABEL[sk]
    const alt = meta ? meta.label : sk
    if (style === 'email') {
      // 이메일: 인라인 스타일, max-width 100%, 2:1 비율 유지, 하단 여백
      return `${match}
      <div style="margin:10px 0 16px;">
        <img src="${escapeHtml(absImg)}" alt="${escapeHtml(alt)}"
             style="display:block;width:100%;max-width:100%;height:auto;aspect-ratio:2/1;object-fit:cover;border-radius:10px;" />
      </div>`
    }
    // 웹: 같은 비율, 클래스 부여 → CSS에서 hover 등 추가 가능
    return `${match}
      <div class="cat-img-wrap"><img class="cat-img" src="${escapeHtml(absImg)}" alt="${escapeHtml(alt)}" loading="lazy" /></div>`
  })
}

export function renderDailyEmail(d: EmailTemplateData): string {
  // AI 요약 HTML — markdown 변환 후 각 H2 카테고리 헤딩 아래에 대표 이미지 삽입
  const summaryHtml = injectSectionImagesIntoHtml(
    markdownToHtml(d.summaryMarkdown),
    d.sectionImages,
    d.siteUrl,
    'email',
  )
  const dateLabel = formatKoreanDate(d.date)
  const unsubUrl = `${d.siteUrl}/unsubscribe?token=${d.unsubscribeToken}`
  const webUrl = `${d.siteUrl}/archive/${d.date}`

  const logoBlock = d.logoUrl
    ? `<img src="${escapeHtml(d.logoUrl)}" alt="모투스" style="height:32px;margin-bottom:8px;" />`
    : `<div style="font-size:14px;color:rgba(255,255,255,0.85);font-weight:600;letter-spacing:0.5px;">MOTUS COMPANY</div>`

  // 자사 콘텐츠 섹션
  let companyBlock = ''
  if (d.companyContents.length > 0) {
    const cards = d.companyContents.map(c => {
      const linkUrl = c.external_link
        ? `${d.siteUrl}/c/${c.id}/click?source=email`
        : `${d.siteUrl}/content/${c.id}`
      const img = c.image_url
        ? `<img src="${escapeHtml(c.image_url)}" alt="${escapeHtml(c.title)}" style="width:140px;height:140px;object-fit:cover;border-radius:8px;display:block;" />`
        : `<div style="width:140px;height:140px;background:linear-gradient(135deg,#f0c14b 0%,#e09b3d 100%);border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:28px;">🏢</div>`
      const summary = stripHtml(c.body).slice(0, 110)
      return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:14px;background:#fffaf0;border:1px solid #f0c14b;border-radius:12px;">
        <tr>
          <td style="padding:14px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="width:140px;vertical-align:top;padding-right:14px;">${img}</td>
                <td style="vertical-align:top;">
                  <span style="display:inline-block;padding:3px 10px;background:#f0c14b;color:#5a3e00;font-size:11px;font-weight:700;border-radius:12px;margin-bottom:8px;">${escapeHtml(c.category)}</span>
                  ${c.is_pinned ? '<span style="display:inline-block;padding:3px 10px;background:#e74c3c;color:#fff;font-size:11px;font-weight:700;border-radius:12px;margin-bottom:8px;margin-left:4px;">📌 고정</span>' : ''}
                  <div style="font-size:16px;font-weight:700;color:#2c3e50;margin:4px 0 6px;line-height:1.4;">${escapeHtml(c.title)}</div>
                  <div style="font-size:13px;color:#5a6878;line-height:1.6;margin-bottom:10px;">${escapeHtml(summary)}${summary.length >= 110 ? '...' : ''}</div>
                  <a href="${linkUrl}" style="display:inline-block;padding:7px 16px;background:#2c3e50;color:#fff;text-decoration:none;font-size:13px;border-radius:6px;font-weight:600;">자세히 보기 →</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`
    }).join('')

    companyBlock = `
    <div style="margin:24px 0;">
      <div style="font-size:18px;font-weight:800;color:#2c3e50;margin-bottom:14px;padding-left:4px;border-left:4px solid #f0c14b;padding-left:10px;">
        🎯 모투스 소식
      </div>
      ${cards}
    </div>`
  }

  // 카테고리 통계
  const countLine = Object.entries(d.newsCounts)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ')

  // TOP 뉴스 (이메일은 15건까지만 노출)
  const EMAIL_NEWS_LIMIT = 15
  const visibleNews = d.topNews.slice(0, EMAIL_NEWS_LIMIT)
  const totalNewsCount = d.totalArticles

  // ── 주요 원문 기사: 항상 평탄 리스트로 단순화 (카테고리 대표 이미지는 AI 요약 영역에만 노출)
  //   기존에 이 영역에 카테고리 그룹 박스 + 이미지가 들어갔었으나, 사용자 요구사항에 따라 제거됨.
  const newsBlock = `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      ${visibleNews.map((n, i) => {
        const grp = CATEGORY_GROUP_MAP[n.category] || '기타'
        const meta = CATEGORY_GROUP_META[grp] || { icon: '📌', color: '#7f8c8d' }
        return `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #ecf0f1;">
            <div>
              <span style="display:inline-block;padding:2px 8px;background:${meta.color};color:#fff;font-size:11px;font-weight:700;border-radius:4px;margin-right:6px;">${meta.icon} ${escapeHtml(n.category)}</span>
              <span style="font-size:11px;color:#95a5a6;">${escapeHtml(n.source || '-')}</span>
            </div>
            <a href="${escapeHtml(n.link)}" style="display:block;font-size:14px;color:#2c3e50;font-weight:600;text-decoration:none;margin-top:6px;line-height:1.5;">
              ${i + 1}. ${escapeHtml(n.title)}
            </a>
          </td>
        </tr>`
      }).join('')}
    </table>`

  const remainCount = Math.max(0, totalNewsCount - visibleNews.length)
  const newsAllUrl = `${d.siteUrl}/news/${d.date}`

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>건설·분양 위클리 - ${dateLabel}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f6f8;padding:20px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="max-width:640px;width:100%;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,0.06);">
          <!-- 헤더 -->
          <tr>
            <td style="background:linear-gradient(135deg,#2c3e50 0%,#3498db 100%);padding:32px 28px;color:#fff;">
              ${logoBlock}
              <div style="font-size:13px;opacity:0.85;margin-bottom:6px;">${dateLabel}</div>
              <div style="font-size:24px;font-weight:800;line-height:1.3;margin-bottom:6px;">🏗️ 건설·분양 위클리</div>
              <div style="font-size:13px;opacity:0.9;">AI가 정리해드리는 오늘의 업계 핵심 · 총 ${d.totalArticles}건${countLine ? ` (${countLine})` : ''}</div>
            </td>
          </tr>

          <!-- 본문 -->
          <tr>
            <td style="padding:28px;">
              ${companyBlock}

              <!-- AI 요약 -->
              <div style="margin:24px 0;">
                <div style="font-size:18px;font-weight:800;color:#2c3e50;margin-bottom:14px;border-left:4px solid #3498db;padding-left:10px;">
                  📰 오늘의 AI 요약
                </div>
                <div style="font-size:14px;color:#34495e;line-height:1.75;background:#f8fafc;padding:18px;border-radius:10px;">
                  ${summaryHtml}
                </div>
              </div>

              <!-- 주요 원문 -->
              <div style="margin:24px 0;">
                <div style="font-size:18px;font-weight:800;color:#2c3e50;margin-bottom:8px;border-left:4px solid #3498db;padding-left:10px;">
                  📑 주요 원문 기사 ${visibleNews.length}건${totalNewsCount > visibleNews.length ? ` <span style="font-size:13px;font-weight:400;color:#95a5a6;">(전체 ${totalNewsCount}건)</span>` : ''}
                </div>
                ${newsBlock}
              </div>

              ${remainCount > 0 ? `
              <div style="text-align:center;margin:18px 0 6px;">
                <a href="${newsAllUrl}" style="display:inline-block;padding:12px 28px;background:#3498db;color:#fff;text-decoration:none;font-size:14px;border-radius:8px;font-weight:700;">전체 뉴스 보기 (${remainCount}건 더) →</a>
              </div>` : `
              <div style="text-align:center;margin:18px 0 6px;">
                <a href="${webUrl}" style="display:inline-block;padding:12px 28px;background:#3498db;color:#fff;text-decoration:none;font-size:14px;border-radius:8px;font-weight:700;">전체 기사 웹에서 보기 →</a>
              </div>`}
            </td>
          </tr>

          <!-- 푸터 -->
          <tr>
            <td style="background:#2c3e50;padding:22px 28px;color:#bdc3c7;font-size:12px;line-height:1.7;text-align:center;">
              <div style="font-weight:700;color:#fff;margin-bottom:6px;">${escapeHtml(d.senderName)}</div>
              <div>본 메일은 구독자에게 발송되는 일일 뉴스레터입니다.</div>
              <div style="margin-top:10px;">
                <a href="${unsubUrl}" style="color:#95a5a6;text-decoration:underline;">구독 해지</a>
                &nbsp;·&nbsp;
                <a href="${d.siteUrl}" style="color:#95a5a6;text-decoration:underline;">웹사이트</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function stripHtml(s: string): string {
  return (s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

// ════════════════════════════════════════════════════════════════════
// 위클리(Weekly) 이메일 템플릿
// ════════════════════════════════════════════════════════════════════

export interface WeeklyEmailTemplateData {
  // 발행 메타
  volNo: number                  // 정수 VOL.번호
  weekStart: string              // YYYY-MM-DD
  weekEnd: string                // YYYY-MM-DD
  issueDate: string              // 발행일 (월요일)
  weekRangeKo: string            // "5/25(월) ~ 5/31(일)"
  issueLabelKo: string           // "2026년 5월 4주차"
  nextIssueKo: string            // "6월 8일(월) 오전 7시"
  // 콘텐츠
  marketOneliner: string | null  // 시장 한 줄 요약
  summaryMarkdown: string        // Claude 본문 (마크다운)
  top3: WeeklyTopNews[]          // 알고리즘 선정 TOP 3
  totalArticles: number          // 주간 집계 기사 수
  companyContents: CompanyContent[]
  // 환경
  siteUrl: string
  unsubscribeToken: string
  logoUrl?: string | null
  senderName: string             // "모투스 위클리"

  // ── 이미지 (옵션, 운영자가 관리자 페이지에서 업로드한 자산)
  // sectionImages: { urban: '/r2/...', sale: '/r2/...', ... }
  sectionImages?: Record<string, string>
  // topImages: 호별 TOP 슬롯 1~2장 (TOP3 위에 노출)
  topImages?: Array<{ slot: number; image_url: string; caption?: string | null; link_url?: string | null }>
}

// ════════════════════════════════════════════════════════════════════
// 위클리 마크다운 파서 (NEW: 헤드라인 모음 스타일용)
// ════════════════════════════════════════════════════════════════════

/**
 * markdown 본문에서 "## " 헤더 단위로 섹션 분리
 * Returns: [{ heading, body }] (heading은 ## 뒤의 텍스트, body는 다음 ## 전까지)
 */
function splitSectionsByH2(md: string): { heading: string; body: string }[] {
  if (!md) return []
  const out: { heading: string; body: string }[] = []
  // ## 줄 단위로 split
  const lines = md.split(/\r?\n/)
  let current: { heading: string; body: string } | null = null
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/)
    if (m) {
      if (current) out.push(current)
      current = { heading: m[1].trim(), body: '' }
    } else if (current) {
      current.body += line + '\n'
    }
  }
  if (current) out.push(current)
  return out
}

/**
 * 섹션 body에서 불릿 라인만 추출 (- 또는 • 시작)
 * 빈줄 / 예시 안내 / 잡음 제거
 */
function extractBullets(body: string): string[] {
  return body.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => /^[-•*]\s+/.test(l))
    .map(l => l.replace(/^[-•*]\s+/, '').replace(/\*\*/g, '').trim())
    .filter(l => l.length > 0)
    .filter(l => !/^예시[\s:]/.test(l))  // "예시:" 라인 제거
}

/**
 * 섹션 body에서 단락 텍스트(불릿 X) 추출
 */
function extractParagraphLines(body: string): string[] {
  return body.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .filter(l => !/^[-•*]\s+/.test(l))
    .filter(l => !/^>/.test(l))
    .filter(l => !/^예시[\s:]/.test(l))
}

/**
 * 헤더 문자열에서 이모지 + 제목 분리
 * "🏗️ 도시정비 동향" → { icon: "🏗️", title: "도시정비 동향" }
 */
function splitHeading(heading: string): { icon: string; title: string } {
  // 첫 토큰이 이모지(또는 비-영숫자)면 분리
  const m = heading.match(/^(\S+)\s+(.+)$/)
  if (m && !/[a-zA-Z0-9가-힣]/.test(m[1][0])) {
    return { icon: m[1], title: m[2].trim() }
  }
  return { icon: '📌', title: heading.trim() }
}

/**
 * 섹션 헤더 → 키 매핑 (이모지/제목 변형에도 강인하게)
 */
type SectionKey =
  | 'keyword' | 'oneline' | 'oneliner' | 'urban'
  | 'sale' | 'builder' | 'policy' | 'media'
  | 'company' | 'insight' | 'calendar' | 'other'

function classifySection(heading: string): SectionKey {
  const t = heading.toLowerCase()
  if (/keyword|키워드/.test(t)) return 'keyword'
  if (/한\s*줄\s*정리|체크리스트/.test(heading)) return 'oneline'
  if (/시장\s*한\s*줄|한\s*줄\s*요약/.test(heading)) return 'oneliner'
  if (/도시정비|재개발|재건축/.test(heading)) return 'urban'
  if (/분양|청약/.test(heading)) return 'sale'
  if (/건설사|건설업계/.test(heading)) return 'builder'
  if (/정책|시장|금리|규제/.test(heading)) return 'policy'
  if (/광고|매체|미디어/.test(heading)) return 'media'
  if (/인사이트|관점|리서치팀/.test(heading)) return 'insight'
  if (/캘린더|다음\s*주|체크포인트|일정/.test(heading)) return 'calendar'
  // GS 위클리, 자이, 회사명 등 → company로 분류 (이모지 🔵 동그라미 류 포함)
  if (/위클리|동향$|소식|gs|건설\s*&|🔵|🟢|🟠/i.test(heading)) return 'company'
  return 'other'
}

/**
 * 섹션 분류별 색상/메타
 */
const SECTION_THEMES: Record<SectionKey, { color: string; bg: string; light: string; icon: string }> = {
  keyword:  { color: '#5b21b6', bg: '#f3eafe', light: '#ede4fc', icon: '🔑' },
  oneline:  { color: '#0f766e', bg: '#ecfdf5', light: '#d1fae5', icon: '✅' },
  oneliner: { color: '#a67c00', bg: '#fef9e7', light: '#fef5d3', icon: '✍️' },
  urban:    { color: '#dc2626', bg: '#fef2f2', light: '#fee2e2', icon: '🏗️' },
  sale:     { color: '#2563eb', bg: '#eff6ff', light: '#dbeafe', icon: '🏢' },
  builder:  { color: '#92400e', bg: '#fffbeb', light: '#fef3c7', icon: '🔨' },
  policy:   { color: '#475569', bg: '#f1f5f9', light: '#e2e8f0', icon: '📊' },
  media:    { color: '#be185d', bg: '#fdf2f8', light: '#fce7f3', icon: '📢' },
  company:  { color: '#1e40af', bg: '#eef2ff', light: '#dbeafe', icon: '🔵' },
  insight:  { color: '#92400e', bg: '#fffbeb', light: '#fef3c7', icon: '💡' },
  calendar: { color: '#0f766e', bg: '#ecfdf5', light: '#d1fae5', icon: '📅' },
  other:    { color: '#7f8c8d', bg: '#f8fafc', light: '#e5eaf0', icon: '📌' },
}

/**
 * 섹션 한 줄 요약 (불릿 위 인용박스용)
 * 첫 단락 라인을 사용하거나, 없으면 기본 문구 사용
 */
function makeSectionLead(key: SectionKey, paragraphs: string[], bulletCount: number): string {
  // 단락 라인이 있으면 첫 번째를 lead로 사용 (100자 cap)
  const first = paragraphs.find(p => p.length >= 6 && !/^예시|^예시:/i.test(p))
  if (first) {
    return first.length > 100 ? first.slice(0, 97) + '...' : first
  }
  // fallback: 섹션별 default
  const defaults: Record<SectionKey, string> = {
    keyword:  '이번 주를 관통하는 키워드',
    oneline:  `이번 주 시장을 ${bulletCount}줄로 요약했습니다.`,
    oneliner: '이번 주 시장 한 줄 요약',
    urban:    `정비사업 헤드라인 ${bulletCount}건`,
    sale:     `분양·청약 헤드라인 ${bulletCount}건`,
    builder:  `건설사 동향 ${bulletCount}건`,
    policy:   `정책·시장 헤드라인 ${bulletCount}건`,
    media:    `광고·매체 헤드라인 ${bulletCount}건`,
    company:  `자사 관련 헤드라인 ${bulletCount}건`,
    insight:  '모투스 리서치팀 관점',
    calendar: `다음 주 일정 ${bulletCount}건`,
    other:    '',
  }
  return defaults[key]
}

/**
 * 섹션 → "더 보기" 링크 URL
 */
function buildSectionMoreUrl(siteUrl: string, weekStart: string, key: SectionKey): string {
  // 카테고리 그룹 ID로 라우팅
  const catMap: Record<SectionKey, string> = {
    urban: '도시정비', sale: '부동산', policy: '부동산', builder: '부동산',
    media: '광고/매체', company: '도시정비',
    keyword: '', oneline: '', oneliner: '', insight: '', calendar: '', other: '',
  }
  const cat = catMap[key]
  if (!cat) return `${siteUrl}/archive/${weekStart}`
  return `${siteUrl}/archive/${weekStart}#${encodeURIComponent(cat)}`
}

/**
 * KEYWORD pill HTML 생성 (5~7개 해시태그)
 */
function renderKeywordPills(bullets: string[]): string {
  if (bullets.length === 0) return ''
  // 본문에 #이 있을 수도 / 없을 수도. 표준화.
  const tags = bullets.map(b => {
    let t = b.replace(/^#+/, '').replace(/\s+/g, '').trim()
    if (!t) return null
    return `#${t}`
  }).filter((x): x is string => !!x).slice(0, 8)
  if (tags.length === 0) return ''

  const pills = tags.map(t => `
    <span style="display:inline-block;padding:6px 12px;margin:3px 4px 3px 0;background:#ede4fc;color:#5b21b6;font-size:13px;font-weight:700;border-radius:999px;line-height:1.4;">
      ${escapeHtml(t)}
    </span>`).join('')

  return `
    <div style="margin:0 0 22px;padding:18px 20px;background:#f8f4ff;border-radius:12px;">
      <div style="font-size:11px;font-weight:800;color:#5b21b6;letter-spacing:1.5px;margin-bottom:10px;">🔑 THIS WEEK KEYWORD</div>
      <div style="line-height:1.9;">${pills}</div>
    </div>`
}

/**
 * 한 줄 정리 체크리스트 HTML (5~7줄)
 */
function renderOneLineChecklist(bullets: string[]): string {
  if (bullets.length === 0) return ''
  const rows = bullets.slice(0, 8).map(b => `
    <tr>
      <td style="vertical-align:top;width:24px;padding:4px 8px 4px 0;color:#0f766e;font-size:14px;font-weight:800;">✓</td>
      <td style="vertical-align:top;padding:4px 0;font-size:14px;color:#0f3531;font-weight:600;line-height:1.55;">${escapeHtml(b)}</td>
    </tr>`).join('')

  return `
    <div style="margin:0 0 22px;padding:18px 20px;background:#ecfdf5;border-left:5px solid #0f766e;border-radius:8px;">
      <div style="font-size:11px;font-weight:800;color:#0f766e;letter-spacing:1.5px;margin-bottom:10px;">✅ ONE-LINE BRIEF</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>
    </div>`
}

/**
 * 시장 한 줄 박스 (extractMarketOneliner로 추출한 텍스트)
 */
function renderMarketOneliner(oneliner: string): string {
  if (!oneliner) return ''
  return `
    <div style="margin:0 0 22px;padding:18px 20px;background:linear-gradient(135deg,#fef9e7 0%,#fef5d3 100%);border-left:5px solid #f0c14b;border-radius:8px;">
      <div style="font-size:11px;font-weight:800;color:#a67c00;letter-spacing:1.5px;margin-bottom:8px;">✍️ 이번 주 시장 한 줄</div>
      <div style="font-size:17px;font-weight:700;color:#2c3e50;line-height:1.55;">${escapeHtml(oneliner)}</div>
    </div>`
}

/**
 * 표준 헤드라인 섹션 (도시정비/분양/건설사/정책/광고/회사) — 카드 형태
 * - 인용박스(┃) lead
 * - (선택) 대표 이미지
 * - 1줄 불릿 리스트
 * - "👉 더 보기" 링크
 */
function renderHeadlineSection(params: {
  heading: string
  key: SectionKey
  bullets: string[]
  lead: string
  isMain?: boolean       // ★ 메인 섹션(도시정비)은 하이라이트
  representativeImg?: string  // 섹션 대표 이미지(선택)
  moreUrl: string
  moreLabel?: string
}): string {
  const { heading, key, bullets, lead, isMain, representativeImg, moreUrl } = params
  const theme = SECTION_THEMES[key]
  const { icon, title } = splitHeading(heading)

  if (bullets.length === 0) return ''  // 비어있으면 통째로 생략

  const bulletRows = bullets.map(b => `
    <tr>
      <td style="vertical-align:top;width:18px;padding:6px 6px 6px 0;color:${theme.color};font-size:14px;font-weight:800;line-height:1.5;">•</td>
      <td style="vertical-align:top;padding:6px 0;font-size:14px;color:#1f2937;font-weight:500;line-height:1.55;">${escapeHtml(b)}</td>
    </tr>`).join('')

  const mainBadge = isMain
    ? `<span style="display:inline-block;padding:2px 8px;margin-left:8px;background:#dc2626;color:#fff;font-size:10px;font-weight:800;border-radius:4px;letter-spacing:1px;vertical-align:middle;">MAIN</span>`
    : ''

  const imgBlock = representativeImg
    ? `<img src="${escapeHtml(representativeImg)}" alt="${escapeHtml(title)}" style="width:100%;max-height:160px;object-fit:cover;border-radius:8px;margin:10px 0 14px;display:block;" />`
    : ''

  // 인용박스(┃)는 좌측 굵은 보더 + light 배경
  const leadBox = lead ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 12px;background:${theme.light};border-left:4px solid ${theme.color};border-radius:6px;">
      <tr>
        <td style="padding:10px 14px;font-size:13px;color:${theme.color};font-weight:700;line-height:1.55;">
          ${escapeHtml(lead)}
        </td>
      </tr>
    </table>` : ''

  return `
    <div style="margin:0 0 26px;">
      <div style="font-size:18px;font-weight:800;color:#111827;margin-bottom:12px;padding-left:10px;border-left:4px solid ${theme.color};">
        ${icon} ${escapeHtml(title)}${mainBadge}
        <span style="float:right;font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:0.5px;">${bullets.length}건</span>
      </div>
      ${leadBox}
      ${imgBlock}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff;">
        ${bulletRows}
      </table>
      <div style="margin-top:10px;text-align:right;">
        <a href="${moreUrl}" style="display:inline-block;font-size:12px;color:${theme.color};text-decoration:none;font-weight:700;">
          👉 더 보기 →
        </a>
      </div>
    </div>`
}

/**
 * 인사이트 섹션 (단락 3~5줄) — 카드 형태
 */
function renderInsightSection(heading: string, paragraphs: string[]): string {
  if (paragraphs.length === 0) return ''
  const { icon, title } = splitHeading(heading)
  const lines = paragraphs.slice(0, 6).map(p => `
    <div style="font-size:14px;color:#1f2937;line-height:1.75;margin:0 0 8px;">${escapeHtml(p)}</div>`).join('')

  return `
    <div style="margin:0 0 26px;padding:20px 22px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;">
      <div style="font-size:14px;font-weight:800;color:#92400e;letter-spacing:1px;margin-bottom:12px;">
        ${icon} ${escapeHtml(title)}
      </div>
      ${lines}
    </div>`
}

/**
 * 캘린더 섹션 (날짜 + 이벤트) — 그리드 카드
 */
function renderCalendarSection(heading: string, bullets: string[]): string {
  if (bullets.length === 0) return ''
  const { icon } = splitHeading(heading)

  // 각 불릿에서 "MM/DD(요일) — 이벤트명" 분리 시도
  const items = bullets.slice(0, 8).map(b => {
    // 정규식: "6/10(화) — 이벤트" 형태
    const m = b.match(/^([0-9]{1,2}\/[0-9]{1,2}(?:\([^)]+\))?)\s*[—\-:·]\s*(.+)$/)
    if (m) return { date: m[1], event: m[2].trim() }
    // 매칭 안되면 전체를 event로
    return { date: '·', event: b }
  })

  const rows = items.map(it => `
    <tr>
      <td style="vertical-align:top;padding:10px 12px;background:#ecfdf5;border:1px solid #d1fae5;border-radius:8px;width:90px;text-align:center;">
        <div style="font-size:13px;font-weight:800;color:#0f766e;line-height:1.3;">${escapeHtml(it.date)}</div>
      </td>
      <td style="vertical-align:middle;padding:10px 14px;font-size:14px;color:#1f2937;font-weight:600;line-height:1.5;">
        ${escapeHtml(it.event)}
      </td>
    </tr>
    <tr><td colspan="2" style="height:8px;line-height:8px;font-size:1px;">&nbsp;</td></tr>`).join('')

  return `
    <div style="margin:0 0 26px;">
      <div style="font-size:18px;font-weight:800;color:#111827;margin-bottom:12px;padding-left:10px;border-left:4px solid #0f766e;">
        ${icon} 다음 주 캘린더
        <span style="float:right;font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:0.5px;">${items.length}건</span>
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-spacing:0;">
        ${rows}
      </table>
    </div>`
}

// ════════════════════════════════════════════════════════════════════
// 메인 렌더러 (NEW: 헤드라인 모음 스타일)
// ════════════════════════════════════════════════════════════════════

export function renderWeeklyEmail(d: WeeklyEmailTemplateData): string {
  const unsubUrl = `${d.siteUrl}/unsubscribe?token=${d.unsubscribeToken}`
  const webUrl = `${d.siteUrl}/archive/${d.weekStart}`
  const volStr = `VOL.${String(d.volNo).padStart(3, '0')}`

  const logoBlock = d.logoUrl
    ? `<img src="${escapeHtml(d.logoUrl)}" alt="MOTUS" style="height:32px;margin-bottom:8px;" />`
    : `<div style="font-size:13px;color:rgba(255,255,255,0.85);font-weight:600;letter-spacing:1.5px;">MOTUS WEEKLY</div>`

  // ── 자사 콘텐츠 카드 (위 기존 로직 유지 — 모투스 소식)
  let companyBlock = ''
  if (d.companyContents.length > 0) {
    const cards = d.companyContents.map(c => {
      const linkUrl = c.external_link
        ? `${d.siteUrl}/c/${c.id}/click?source=email`
        : `${d.siteUrl}/content/${c.id}`
      const img = c.image_url
        ? `<img src="${escapeHtml(c.image_url)}" alt="${escapeHtml(c.title)}" style="width:120px;height:120px;object-fit:cover;border-radius:8px;display:block;" />`
        : `<div style="width:120px;height:120px;background:linear-gradient(135deg,#f0c14b 0%,#e09b3d 100%);border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;">🏢</div>`
      const summary = stripHtml(c.body).slice(0, 80)
      return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:10px;background:#fffaf0;border:1px solid #f0c14b;border-radius:10px;">
        <tr>
          <td style="padding:12px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="width:120px;vertical-align:top;padding-right:12px;">${img}</td>
                <td style="vertical-align:top;">
                  <span style="display:inline-block;padding:2px 8px;background:#f0c14b;color:#5a3e00;font-size:10px;font-weight:700;border-radius:10px;">${escapeHtml(c.category)}</span>
                  ${c.is_pinned ? '<span style="display:inline-block;padding:2px 8px;background:#e74c3c;color:#fff;font-size:10px;font-weight:700;border-radius:10px;margin-left:3px;">📌</span>' : ''}
                  <div style="font-size:15px;font-weight:700;color:#2c3e50;margin:6px 0 4px;line-height:1.4;">${escapeHtml(c.title)}</div>
                  <div style="font-size:12px;color:#5a6878;line-height:1.5;margin-bottom:8px;">${escapeHtml(summary)}${summary.length >= 80 ? '...' : ''}</div>
                  <a href="${linkUrl}" style="display:inline-block;padding:5px 12px;background:#2c3e50;color:#fff;text-decoration:none;font-size:12px;border-radius:5px;font-weight:600;">자세히 →</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`
    }).join('')

    companyBlock = `
    <div style="margin:0 0 26px;">
      <div style="font-size:18px;font-weight:800;color:#111827;margin-bottom:12px;padding-left:10px;border-left:4px solid #f0c14b;">
        🎯 모투스 소식
      </div>
      ${cards}
    </div>`
  }

  // ── 호별 TOP 이미지 (운영자 업로드, slot 1~2)
  // siteUrl 기준 절대 URL 보정
  const absImg = (u: string): string => {
    if (/^https?:\/\//i.test(u)) return u
    return `${d.siteUrl}${u.startsWith('/') ? '' : '/'}${u}`
  }
  const topImagesBlock = (d.topImages && d.topImages.length > 0) ? `
    <div style="margin:0 0 22px;">
      ${d.topImages.slice(0, 2).map(t => {
        const href = t.link_url ? escapeHtml(absImg(t.link_url)) : ''
        const imgHtml = `<img src="${escapeHtml(absImg(t.image_url))}" alt="${escapeHtml(t.caption || `TOP 이미지 ${t.slot}`)}" style="width:100%;max-height:240px;object-fit:cover;border-radius:10px;display:block;" />`
        const wrapped = href
          ? `<a href="${href}" style="text-decoration:none;display:block;">${imgHtml}</a>`
          : imgHtml
        const cap = t.caption
          ? `<div style="margin-top:6px;font-size:12px;color:#5a6878;text-align:center;line-height:1.5;">${escapeHtml(t.caption)}</div>`
          : ''
        return `
        <div style="margin:0 0 12px;">
          ${wrapped}
          ${cap}
        </div>`
      }).join('')}
    </div>` : ''

  // ── TOP 3 카드 (간소화)
  const top3Block = d.top3.length > 0 ? `
    <div style="margin:0 0 26px;">
      <div style="font-size:18px;font-weight:800;color:#111827;margin-bottom:12px;padding-left:10px;border-left:4px solid #2c3e50;">
        🔥 이번 주 핵심 이슈 TOP ${d.top3.length}
      </div>
      ${d.top3.map(t => {
        const grp = (t.category && CATEGORY_GROUP_MAP[t.category as any]) || '기타'
        const meta = CATEGORY_GROUP_META[grp] || { icon: '📌', color: '#7f8c8d' }
        const link = t.link || '#'
        return `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:8px;background:#fff;border:1px solid #e5eaf0;border-radius:8px;">
          <tr>
            <td style="padding:10px 14px;">
              <div style="display:inline-block;width:24px;height:24px;background:${meta.color};color:#fff;font-size:12px;font-weight:800;text-align:center;line-height:24px;border-radius:50%;margin-right:8px;vertical-align:middle;">${t.rank}</div>
              <span style="display:inline-block;padding:2px 7px;background:${meta.color};color:#fff;font-size:10px;font-weight:700;border-radius:3px;vertical-align:middle;">${meta.icon} ${escapeHtml(t.category || '-')}</span>
              <a href="${escapeHtml(link)}" style="display:block;font-size:14px;color:#2c3e50;font-weight:700;text-decoration:none;margin-top:6px;line-height:1.5;">
                ${escapeHtml(t.title)}
              </a>
            </td>
          </tr>
        </table>`
      }).join('')}
    </div>` : ''

  // ════════════════════════════════════════════════════════════════════
  // 본문 마크다운 파싱
  // ════════════════════════════════════════════════════════════════════
  const sections = splitSectionsByH2(d.summaryMarkdown)

  // 섹션 분류 → 한 번에 모음
  type Sec = { heading: string; key: SectionKey; bullets: string[]; paragraphs: string[] }
  const allSecs: Sec[] = sections.map(s => ({
    heading: s.heading,
    key: classifySection(s.heading),
    bullets: extractBullets(s.body),
    paragraphs: extractParagraphLines(s.body),
  }))

  const byKey = (k: SectionKey): Sec | undefined => allSecs.find(s => s.key === k)
  const keywordSec  = byKey('keyword')
  const onelineSec  = byKey('oneline')
  const urbanSec    = byKey('urban')
  const saleSec     = byKey('sale')
  const builderSec  = byKey('builder')
  const policySec   = byKey('policy')
  const mediaSec    = byKey('media')
  const companySec  = byKey('company')
  const insightSec  = byKey('insight')
  const calendarSec = byKey('calendar')

  // ── 본문 섹션 HTML 조립 (사용자 요구 순서)
  // [1] 헤더 → [2] KEYWORD → [3] 한 줄 정리 → [4] 시장 한 줄
  // [5] TOP3(시그니처 유지) → [6] 모투스 소식
  // [7] 🏗️ 도시정비 (MAIN) → [8] 🏢 분양·청약 → [9] 🔨 건설사
  // [10] 📊 정책·시장 → [11] 📢 광고/매체 → [12] 🔵 회사 위클리
  // [13] 💡 인사이트 → [14] 📅 캘린더 → [15] CTA → [16] 푸터

  const keywordHtml = keywordSec ? renderKeywordPills(keywordSec.bullets) : ''
  const onelineHtml = onelineSec ? renderOneLineChecklist(onelineSec.bullets) : ''
  const onelinerHtml = renderMarketOneliner(d.marketOneliner?.trim() || '')

  const sectionBlocks: string[] = []

  // ── 섹션별 대표 이미지(운영자 업로드) — 절대 URL로 보정
  const secImg = (key: SectionKey): string | undefined => {
    const raw = d.sectionImages?.[key]
    if (!raw) return undefined
    // /r2/... 같은 상대 경로면 siteUrl과 결합 (이메일에서 절대 URL 필요)
    if (/^https?:\/\//i.test(raw)) return raw
    return `${d.siteUrl}${raw.startsWith('/') ? '' : '/'}${raw}`
  }

  if (urbanSec) sectionBlocks.push(renderHeadlineSection({
    heading: urbanSec.heading, key: 'urban', bullets: urbanSec.bullets,
    lead: makeSectionLead('urban', urbanSec.paragraphs, urbanSec.bullets.length),
    isMain: true,
    representativeImg: secImg('urban'),
    moreUrl: buildSectionMoreUrl(d.siteUrl, d.weekStart, 'urban'),
  }))

  if (saleSec) sectionBlocks.push(renderHeadlineSection({
    heading: saleSec.heading, key: 'sale', bullets: saleSec.bullets,
    lead: makeSectionLead('sale', saleSec.paragraphs, saleSec.bullets.length),
    representativeImg: secImg('sale'),
    moreUrl: buildSectionMoreUrl(d.siteUrl, d.weekStart, 'sale'),
  }))

  if (builderSec) sectionBlocks.push(renderHeadlineSection({
    heading: builderSec.heading, key: 'builder', bullets: builderSec.bullets,
    lead: makeSectionLead('builder', builderSec.paragraphs, builderSec.bullets.length),
    representativeImg: secImg('builder'),
    moreUrl: buildSectionMoreUrl(d.siteUrl, d.weekStart, 'builder'),
  }))

  if (policySec) sectionBlocks.push(renderHeadlineSection({
    heading: policySec.heading, key: 'policy', bullets: policySec.bullets,
    lead: makeSectionLead('policy', policySec.paragraphs, policySec.bullets.length),
    representativeImg: secImg('policy'),
    moreUrl: buildSectionMoreUrl(d.siteUrl, d.weekStart, 'policy'),
  }))

  if (mediaSec) sectionBlocks.push(renderHeadlineSection({
    heading: mediaSec.heading, key: 'media', bullets: mediaSec.bullets,
    lead: makeSectionLead('media', mediaSec.paragraphs, mediaSec.bullets.length),
    representativeImg: secImg('media'),
    moreUrl: buildSectionMoreUrl(d.siteUrl, d.weekStart, 'media'),
  }))

  if (companySec) sectionBlocks.push(renderHeadlineSection({
    heading: companySec.heading, key: 'company', bullets: companySec.bullets,
    lead: makeSectionLead('company', companySec.paragraphs, companySec.bullets.length),
    representativeImg: secImg('company'),
    moreUrl: buildSectionMoreUrl(d.siteUrl, d.weekStart, 'company'),
    moreLabel: '자사 동향 전체 보기',
  }))

  if (insightSec) sectionBlocks.push(renderInsightSection(insightSec.heading, insightSec.paragraphs))

  if (calendarSec) sectionBlocks.push(renderCalendarSection(calendarSec.heading, calendarSec.bullets))

  // 분류 안 된 섹션 fallback (예: 미지 섹션) — markdown으로 폴백
  const otherSecs = allSecs.filter(s => s.key === 'other')
  let otherBlock = ''
  if (otherSecs.length > 0) {
    otherBlock = otherSecs.map(s => `
      <div style="margin:0 0 18px;padding:14px 16px;background:#f8fafc;border-radius:8px;">
        <div style="font-size:14px;font-weight:700;color:#2c3e50;margin-bottom:8px;">## ${escapeHtml(s.heading)}</div>
        <div style="font-size:13px;color:#475569;line-height:1.7;">${markdownToHtml(s.bullets.map(b => '- ' + b).join('\n') + '\n' + s.paragraphs.join('\n'))}</div>
      </div>`).join('')
  }

  // ── 파싱이 완전 실패한 경우 (헤더 0개) → markdownToHtml fallback
  const parsingFailed = sectionBlocks.length === 0 && !keywordHtml && !onelineHtml
  const fallbackHtml = parsingFailed ? `
    <div style="margin:24px 0;">
      <div style="font-size:18px;font-weight:800;color:#111827;margin-bottom:12px;padding-left:10px;border-left:4px solid #3498db;">
        📰 이번 주 핵심 인사이트
      </div>
      <div style="font-size:14px;color:#34495e;line-height:1.85;background:#f8fafc;padding:20px;border-radius:10px;">
        ${markdownToHtml(d.summaryMarkdown)}
      </div>
    </div>` : ''

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>모투스 위클리 ${volStr} · ${d.issueLabelKo}</title>
  <style>
    @media only screen and (max-width: 480px) {
      .mw-card { padding: 18px !important; }
      .mw-head-title { font-size: 20px !important; }
      .mw-head-meta { font-size: 12px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f6f8;padding:20px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="max-width:640px;width:100%;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,0.06);">
          <!-- [1] 헤더 -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a2540 0%,#2c3e50 60%,#3498db 100%);padding:30px 28px;color:#fff;">
              ${logoBlock}
              <div class="mw-head-meta" style="font-size:11px;letter-spacing:2px;color:rgba(255,255,255,0.75);font-weight:700;margin:6px 0 4px;">
                ${volStr} · ${escapeHtml(d.issueLabelKo)}
              </div>
              <div class="mw-head-title" style="font-size:24px;font-weight:800;line-height:1.3;margin-bottom:6px;">📬 모투스 위클리</div>
              <div style="font-size:12px;opacity:0.85;line-height:1.55;">
                ${escapeHtml(d.weekRangeKo)} · 이번 주 ${d.totalArticles}건 분석 · 30초 헤드라인 모음
              </div>
            </td>
          </tr>

          <!-- 본문 -->
          <tr>
            <td class="mw-card" style="padding:24px 26px 18px;">

              <!-- [2] KEYWORD pill -->
              ${keywordHtml}

              <!-- [3] 한 줄 정리 -->
              ${onelineHtml}

              <!-- [4] 시장 한 줄 -->
              ${onelinerHtml}

              <!-- [5-pre] 호별 운영자 업로드 TOP 이미지 (1~2개) -->
              ${topImagesBlock}

              <!-- [5] TOP3 (시그니처 유지) -->
              ${top3Block}

              <!-- [6] 모투스 소식 -->
              ${companyBlock}

              <!-- [7~12] 섹션 헤드라인 카드들 -->
              ${sectionBlocks.join('\n')}

              <!-- 파싱 안된 섹션 fallback -->
              ${otherBlock}

              <!-- 파싱 완전 실패 fallback -->
              ${fallbackHtml}

              <!-- [13] CTA -->
              <div style="text-align:center;margin:24px 0 6px;">
                <a href="${webUrl}" style="display:inline-block;padding:13px 30px;background:#2c3e50;color:#fff;text-decoration:none;font-size:14px;border-radius:8px;font-weight:700;">웹에서 전체 호 보기 →</a>
              </div>

              <!-- 다음 호 안내 -->
              <div style="margin:22px 0 4px;padding:12px 16px;background:#f8fafc;border-radius:8px;text-align:center;">
                <div style="font-size:10px;color:#7f8c8d;letter-spacing:1.5px;font-weight:700;margin-bottom:3px;">📬 NEXT ISSUE</div>
                <div style="font-size:13px;color:#2c3e50;font-weight:600;">${escapeHtml(d.nextIssueKo)}</div>
              </div>

            </td>
          </tr>

          <!-- [14] 푸터 -->
          <tr>
            <td style="background:#1a2540;padding:22px 26px;color:#bdc3c7;font-size:11px;line-height:1.7;text-align:center;">
              <div style="font-weight:700;color:#fff;margin-bottom:5px;font-size:12px;letter-spacing:1.5px;">${escapeHtml(d.senderName)}</div>
              <div style="opacity:0.8;">매주 월요일 오전 7시, 모투스 리서치팀이 정리하는 30초 헤드라인 모음</div>
              <div style="margin-top:10px;">
                <a href="${unsubUrl}" style="color:#95a5a6;text-decoration:underline;">구독 해지</a>
                &nbsp;·&nbsp;
                <a href="${d.siteUrl}" style="color:#95a5a6;text-decoration:underline;">웹사이트</a>
                &nbsp;·&nbsp;
                <a href="${d.siteUrl}/archive" style="color:#95a5a6;text-decoration:underline;">지난 호</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/** 위클리 이메일 제목 생성: "[모투스 위클리] VOL.018 · 2026년 5월 4주차" (간결판) */
export function makeWeeklySubject(volNo: number, issueLabelKo: string, marketOneliner?: string | null): string {
  const volStr = `VOL.${String(volNo).padStart(3, '0')}`
  // 한 줄 요약이 있고 짧으면 부제로 추가 (제목 총 60자 이내 권장)
  if (marketOneliner && marketOneliner.length <= 30) {
    return `[모투스 위클리] ${volStr} · ${issueLabelKo} — ${marketOneliner}`
  }
  return `[모투스 위클리] ${volStr} · ${issueLabelKo}`
}
