// 페이지 HTML 렌더링 (메인, 아카이브, 콘텐츠 상세, 구독해지)

import type { CompanyContent, NewsItem, WeeklySummary, WeeklyTopNews } from '../lib/types'
import {
  escapeHtml, formatKoreanDate, markdownToHtml,
  formatWeekRangeKo, formatIssueLabelKo, formatNextIssueKo,
} from '../lib/utils'

// === 메인 페이지 ('이번 주 호' 중심) ===
// 위클리 데이터(latestWeekly)가 있으면 이번 주 호를 본문으로,
// 없으면 베타 모드(첫 위클리 발행 예정 안내) UI를 노출합니다.
export function renderMainPage(opts: {
  logoUrl?: string | null
  senderName: string
  latestWeekly?: { summary: WeeklySummary; top3: WeeklyTopNews[] } | null
  isAdmin?: boolean
}): string {
  const logo = opts.logoUrl
    ? `<img src="${escapeHtml(opts.logoUrl)}" alt="${escapeHtml(opts.senderName)}" />`
    : `<div style="font-size:13px;letter-spacing:2px;font-weight:700;opacity:0.85;">MOTUS</div>`

  const weekly = opts.latestWeekly || null

  // === 위클리 본문 영역 (정상 모드) ===
  let weeklyBlockHtml = ''
  // SEO 메타 + JSON-LD
  let metaDescription = '매주 월요일 오전 7시, 모투스 리서치팀이 정리한 건설·분양·도시정비 업계 핵심 — 모투스 위클리'
  let ogTitle = '건설·분양 위클리 | 모투스 위클리'
  let jsonLdHtml = ''
  let nextIssueKo = ''

  if (weekly) {
    const s = weekly.summary
    const issueLabelKo = formatIssueLabelKo(s.week_start_date)
    const weekRangeKo = formatWeekRangeKo(s.week_start_date, s.week_end_date)
    nextIssueKo = formatNextIssueKo(s.issue_date)
    const oneliner = (s.market_oneliner || '').trim()
    const summaryHtml = markdownToHtml(s.content || '')
    const volPadded = `VOL.${String(s.vol_no).padStart(3, '0')}`

    // TOP3 카드
    const top3Html = (weekly.top3 || []).map(t => {
      const rankBadge = `<span class="weekly-top-rank">#${t.rank}</span>`
      const sourceLine = [t.source, t.category].filter(Boolean).map(x => escapeHtml(x!)).join(' · ')
      const linkAttr = t.link ? ` href="${escapeHtml(t.link)}" target="_blank" rel="noopener"` : ''
      const titleTag = t.link ? `<a class="weekly-top-title"${linkAttr}>${escapeHtml(t.title)}</a>` : `<span class="weekly-top-title">${escapeHtml(t.title)}</span>`
      const summary = t.summary ? `<div class="weekly-top-summary">${escapeHtml(t.summary)}</div>` : ''
      return `
        <article class="weekly-top-card">
          <div class="weekly-top-head">
            ${rankBadge}
            <div class="weekly-top-meta">${sourceLine}</div>
          </div>
          ${titleTag}
          ${summary}
        </article>`
    }).join('')

    const onelinerBox = oneliner
      ? `<aside class="weekly-oneliner" aria-label="이번 주 시장 한 줄 요약">
           <div class="weekly-oneliner-label">📍 이번 주 시장 한 줄</div>
           <div class="weekly-oneliner-text">${escapeHtml(oneliner)}</div>
         </aside>`
      : ''

    weeklyBlockHtml = `
    <!-- VOL 메타 헤더 -->
    <section class="weekly-meta-card" aria-label="발행 메타">
      <div class="weekly-meta-line">
        <span class="weekly-vol">${escapeHtml(volPadded)}</span>
        <span class="weekly-meta-sep">·</span>
        <span class="weekly-issue-label">${escapeHtml(issueLabelKo)}</span>
      </div>
      <div class="weekly-meta-sub">
        주간 범위 <strong>${escapeHtml(weekRangeKo)}</strong> · 누적 ${s.article_count.toLocaleString()}건 분석
      </div>
    </section>

    ${onelinerBox}

    <!-- TOP 3 핵심 이슈 -->
    <section class="card weekly-top3-card">
      <h2 class="card-title">🔥 이번 주 TOP 3</h2>
      <div class="weekly-top3">${top3Html || '<div class="weekly-empty">TOP3가 아직 준비되지 않았습니다.</div>'}</div>
    </section>

    <!-- 본문 요약 -->
    <section class="card weekly-summary-card">
      <h2 class="card-title">📰 이번 주 호 본문</h2>
      <div class="summary-content">${summaryHtml}</div>
    </section>

    <!-- 다음 호 안내 -->
    <section class="weekly-next-issue" aria-label="다음 호 안내">
      <div class="weekly-next-icon">📅</div>
      <div class="weekly-next-text">
        <div class="weekly-next-title">다음 호 발행 예정</div>
        <div class="weekly-next-date">${escapeHtml(nextIssueKo)}</div>
      </div>
    </section>`

    // SEO 보강
    metaDescription = oneliner
      ? `${oneliner} — 모투스 위클리 ${volPadded} ${issueLabelKo}`
      : `모투스 위클리 ${volPadded} ${issueLabelKo} (${weekRangeKo}) · 매주 월요일 오전 7시 발송`
    ogTitle = `${volPadded} ${issueLabelKo} | 모투스 위클리`

    // JSON-LD (Article)
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": `모투스 위클리 ${volPadded} ${issueLabelKo}`,
      "datePublished": s.issue_date,
      "dateModified": (s.updated_at || s.created_at || s.issue_date).slice(0, 10),
      "description": oneliner || metaDescription,
      "author": { "@type": "Organization", "name": "모투스 리서치팀" },
      "publisher": { "@type": "Organization", "name": "모투스" },
      "articleSection": "건설·분양 위클리"
    }
    jsonLdHtml = `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`
  } else {
    // C-1: 베타 폴백 섹션 미노출
    weeklyBlockHtml = ''
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${escapeHtml(ogTitle)}</title>
  <meta name="description" content="${escapeHtml(metaDescription)}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(ogTitle)}">
  <meta property="og:description" content="${escapeHtml(metaDescription)}">
  <meta property="og:site_name" content="모투스 위클리">
  ${opts.logoUrl ? `<meta property="og:image" content="${escapeHtml(opts.logoUrl)}">` : ''}
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/svg+xml" href="/static/favicon.svg">
  <link href="/static/style.css" rel="stylesheet">
  ${jsonLdHtml}
</head>
<body>
  <nav class="topnav">
    <a href="/" class="topnav-brand">🏗️ 모투스 위클리</a>
    <div class="topnav-menu">
      <a href="/">이번 주 호</a>
      <a href="/search">🔍 뉴스 검색</a>
      ${opts.isAdmin ? '<a href="/admin">관리자</a>' : ''}
    </div>
  </nav>

  <header class="hero hero-weekly">
    <div class="logo-area">${logo}</div>
    <h1>🏗️ 건설·분양 위클리</h1>
    <p>모투스 리서치팀이 정리한 한 주의 업계 핵심 — 매주 월요일 오전 7시</p>
  </header>

  <main class="container" style="margin-top:-50px;position:relative;z-index:1;">

    <!-- 자사 콘텐츠 섹션 (선택 노출) -->
    <section id="company-section" class="company-section" style="display:none;">
      <h2 class="card-title">🎯 모투스 소식</h2>
      <div id="company-grid" class="company-grid"></div>
    </section>

    ${weeklyBlockHtml}

    <!-- 일간 누적 뉴스 (C-3: 원본 뉴스보다 먼저) -->
    <section class="card daily-supplement">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
        <div>
          <h2 class="card-title" style="margin-bottom:6px;">📑 일간 누적 뉴스</h2>
          <div style="font-size:13px;color:#7f8c8d;padding-left:16px;">
            <span id="today-date"></span> · <span id="article-count"></span>
            <span style="color:#bdc3c7;margin-left:6px;">(위클리는 매주 월요일 발송, 일간은 사이트에서만 누적 제공)</span>
          </div>
        </div>
        ${opts.isAdmin ? '<button id="collect-btn" class="btn btn-secondary btn-sm" data-admin-only="true">🔄 지금 새로 수집하기</button>' : ''}
      </div>
      <div id="summary-content" class="summary-content"></div>
    </section>

    <!-- 원본 뉴스 -->
    <section class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
        <h2 class="card-title" style="margin-bottom:0;">📑 원본 뉴스</h2>
        <span id="total-news-count" style="font-size:13px;color:#7f8c8d;"></span>
      </div>
      <div class="cat-filter">
        <button class="active" data-cat="전체">전체</button>
        <button data-cat="부동산">🏢 부동산</button>
        <button data-cat="도시정비">🏗️ 도시정비</button>
        <button data-cat="광고/매체">📺 광고/매체</button>
        <button data-cat="AI">🤖 AI</button>
        <button data-cat="기타">📌 기타</button>
      </div>
      <!-- 광고/매체 하위 분류 필터 (광고/매체 선택 시 노출) -->
      <div id="sub-cat-filter" class="cat-filter sub-cat-filter" style="display:none;margin-top:8px;">
        <button class="active" data-subcat="전체">전체</button>
        <button data-subcat="옥외광고">옥외광고</button>
        <button data-subcat="디지털광고">디지털광고</button>
        <button data-subcat="광고산업">광고산업</button>
        <button data-subcat="미디어">미디어</button>
        <button data-subcat="광고규제">광고규제</button>
      </div>
      <div id="news-list"></div>
      <div id="news-more-wrap" style="text-align:center;margin-top:14px;display:none;">
        <button id="news-more-btn" class="btn btn-secondary">더보기 (<span id="news-remain">0</span>건 더)</button>
      </div>
    </section>

    <!-- 구독 카드 (C-2: 최하단으로 이동) -->
    <section class="subscribe-card">
      <h2>📬 매주 월요일 아침, 메일로 받아보기</h2>
      <p>모투스 리서치팀이 매주 월요일, 한 주간의 건설·분양 업계 핵심을 메일로 보내드립니다.</p>
      <form id="sub-form" class="subscribe-form">
        <input id="sub-name" type="text" placeholder="이름 (선택)" />
        <input id="sub-email" type="email" placeholder="이메일 주소" required />
        <button id="sub-btn" type="submit">구독 신청</button>
      </form>
    </section>

  </main>

  <footer>
    <div>© ${new Date().getFullYear()} 모투스. All rights reserved.</div>
    <div style="margin-top:6px;color:#95a5a6;font-size:12px;">매주 월요일 · 모투스 컴퍼니 발행</div>
    ${opts.isAdmin ? '<div style="margin-top:6px;"><a href="/admin">관리자 로그인</a></div>' : ''}
  </footer>

  <script src="/static/app.js"></script>
</body>
</html>`
}

export function renderSearchPage(opts: { logoUrl?: string | null; senderName: string }): string {
  const logo = opts.logoUrl
    ? `<img src="${escapeHtml(opts.logoUrl)}" alt="${escapeHtml(opts.senderName)}" />`
    : `<div style="font-size:13px;letter-spacing:2px;font-weight:700;opacity:0.85;">MOTUS COMPANY</div>`
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>🔍 뉴스 검색 | 모투스 위클리</title>
  <link rel="icon" type="image/svg+xml" href="/static/favicon.svg">
  <link href="/static/style.css" rel="stylesheet">
</head>
<body>
  <nav class="topnav">
    <a href="/" class="topnav-brand">🏗️ 모투스 위클리</a>
    <div class="topnav-menu">
      <a href="/">이번 주 호</a>
      <a href="/search" class="active">🔍 뉴스 검색</a>
    </div>
  </nav>

  <header class="hero" style="padding:40px 20px;">
    <div class="logo-area">${logo}</div>
    <h1 style="font-size:28px;">🔍 뉴스 검색</h1>
    <p>수집된 과거 뉴스를 키워드·카테고리·기간·언론사로 검색하세요.</p>
  </header>

  <main class="container" style="margin-top:-30px;position:relative;">
    <section class="card">
      <form id="search-form" class="search-form">
        <div class="search-row">
          <input id="sf-q" type="text" placeholder="검색어 입력 (제목, 본문)" autocomplete="off" />
          <button type="submit" class="btn">검색</button>
        </div>
        <div class="search-filters">
          <div class="sf-group">
            <label>카테고리</label>
            <select id="sf-group">
              <option value="">전체</option>
              <option value="부동산">🏢 부동산</option>
              <option value="도시정비">🏗️ 도시정비</option>
              <option value="광고/매체">📺 광고/매체</option>
              <option value="AI">🤖 AI</option>
              <option value="기타">📌 기타</option>
            </select>
          </div>
          <div class="sf-group" id="sf-subcat-wrap" style="display:none;">
            <label>하위 분류</label>
            <select id="sf-subcat">
              <option value="">전체</option>
              <option value="옥외광고">옥외광고</option>
              <option value="디지털광고">디지털광고</option>
              <option value="광고산업">광고산업</option>
              <option value="미디어">미디어</option>
              <option value="광고규제">광고규제</option>
            </select>
          </div>
          <div class="sf-group">
            <label>기간</label>
            <select id="sf-period">
              <option value="">전체</option>
              <option value="today">오늘</option>
              <option value="7">1주일</option>
              <option value="30">1개월</option>
              <option value="90">3개월</option>
              <option value="custom">직접 지정</option>
            </select>
          </div>
          <div class="sf-group sf-custom" style="display:none;">
            <label>시작</label>
            <input id="sf-start" type="date" />
          </div>
          <div class="sf-group sf-custom" style="display:none;">
            <label>종료</label>
            <input id="sf-end" type="date" />
          </div>
          <div class="sf-group">
            <label>언론사</label>
            <select id="sf-source">
              <option value="">전체</option>
            </select>
          </div>
          <div class="sf-group">
            <label>정렬</label>
            <select id="sf-sort">
              <option value="recent">최신순</option>
              <option value="relevance">관련도순</option>
            </select>
          </div>
        </div>
      </form>
    </section>

    <section class="card">
      <div id="search-meta" style="font-size:13px;color:#7f8c8d;margin-bottom:14px;">검색어를 입력하거나 필터를 선택하면 결과가 표시됩니다.</div>
      <div id="search-results"></div>
      <div id="search-pagination" class="pagination"></div>
    </section>
  </main>

  <footer>
    <div>© ${new Date().getFullYear()} 모투스. All rights reserved.</div>
  </footer>

  <script src="/static/search.js"></script>
</body>
</html>`
}

export function renderNewsListPage(opts: {
  date: string
  news: NewsItem[]
  counts: Record<string, number>
}): string {
  const newsHtml = opts.news.map((n, i) => `
    <div class="news-item">
      <div class="news-meta">
        <span class="cat-badge">${escapeHtml(n.category)}</span>
        <span>${escapeHtml(n.source || '-')}</span>
        <span style="color:#bdc3c7;margin-left:auto;font-size:11px;">${(n.pub_date || '').slice(0, 10)}</span>
      </div>
      <h4><a href="${escapeHtml(n.link)}" target="_blank" rel="noopener">${i + 1}. ${escapeHtml(n.title)}</a></h4>
      <div class="desc">${escapeHtml((n.description || '').slice(0, 200))}</div>
    </div>
  `).join('')
  const countLine = Object.entries(opts.counts).map(([k, v]) => `${escapeHtml(k)} ${v}`).join(' · ')
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${formatKoreanDate(opts.date)} 전체 뉴스 | 건설·분양 위클리</title>
  <link rel="icon" type="image/svg+xml" href="/static/favicon.svg">
  <link href="/static/style.css" rel="stylesheet">
</head>
<body>
  <nav class="topnav">
    <a href="/" class="topnav-brand">🏗️ 모투스 위클리</a>
    <div class="topnav-menu">
      <a href="/">이번 주 호</a>
      <a href="/search">🔍 뉴스 검색</a>
    </div>
  </nav>
  <header class="hero" style="padding:40px 20px;">
    <h1 style="font-size:26px;">📑 ${formatKoreanDate(opts.date)} 전체 뉴스</h1>
    <p>총 ${opts.news.length}건${countLine ? ` · ${countLine}` : ''}</p>
  </header>
  <main class="container" style="margin-top:-30px;position:relative;">
    <section class="card">
      <h2 class="card-title">📑 원본 뉴스 (${opts.news.length}건)</h2>
      ${newsHtml || '<div style="color:#95a5a6;text-align:center;padding:40px;">해당 날짜의 뉴스가 없습니다.</div>'}
    </section>
    <div style="text-align:center;margin:30px 0;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
      <a href="/" class="btn btn-secondary">← 메인으로</a>
      <a href="/archive/${opts.date}" class="btn btn-secondary">📰 AI 요약 보기</a>
      <a href="/search" class="btn">🔍 뉴스 검색</a>
    </div>
  </main>
</body>
</html>`
}

export function renderArchivePage(opts: {
  date: string
  summary: string | null
  articleCount: number
  news: NewsItem[]
  counts: Record<string, number>
}): string {
  const summaryHtml = opts.summary ? markdownToHtml(opts.summary) : '<p style="color:#95a5a6;">해당 날짜의 요약이 없습니다.</p>'
  const newsHtml = opts.news.map(n => `
    <div class="news-item">
      <div class="news-meta">
        <span class="cat-badge">${escapeHtml(n.category)}</span>
        <span>${escapeHtml(n.source || '-')}</span>
      </div>
      <h4><a href="${escapeHtml(n.link)}" target="_blank">${escapeHtml(n.title)}</a></h4>
      <div class="desc">${escapeHtml((n.description || '').slice(0, 200))}</div>
    </div>
  `).join('')
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${formatKoreanDate(opts.date)} | 건설·분양 위클리</title>
  <link href="/static/style.css" rel="stylesheet">
</head>
<body>
  <header class="hero" style="padding:40px 20px;">
    <h1 style="font-size:26px;">📅 ${formatKoreanDate(opts.date)}</h1>
    <p>총 ${opts.articleCount}건의 기사</p>
  </header>
  <main class="container" style="margin-top:-30px;position:relative;">
    <section class="card">
      <h2 class="card-title">📰 AI 요약</h2>
      <div class="summary-content">${summaryHtml}</div>
    </section>
    <section class="card">
      <h2 class="card-title">📑 원본 뉴스 (${opts.news.length}건)</h2>
      ${newsHtml || '<div style="color:#95a5a6;">뉴스가 없습니다.</div>'}
    </section>
    <div style="text-align:center;margin:30px 0;">
      <a href="/" class="btn btn-secondary">← 메인으로</a>
    </div>
  </main>
</body>
</html>`
}

export function renderContentDetailPage(c: CompanyContent): string {
  const bodyHtml = markdownToHtml(c.body)
  const img = c.image_url
    ? `<img src="${escapeHtml(c.image_url)}" alt="" style="width:100%;max-height:400px;object-fit:cover;border-radius:12px;margin-bottom:20px;" />`
    : ''
  const link = c.external_link
    ? `<div style="text-align:center;margin:20px 0;"><a href="/c/${c.id}/click?source=web&redirect=${encodeURIComponent(c.external_link)}" class="btn" target="_blank">자세히 보기 →</a></div>`
    : ''
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${escapeHtml(c.title)} | 모투스</title>
  <link href="/static/style.css" rel="stylesheet">
</head>
<body>
  <main class="container" style="padding-top:30px;">
    <a href="/" style="font-size:13px;">← 메인으로</a>
    <article class="card" style="margin-top:14px;">
      <div style="margin-bottom:12px;">
        <span class="tag tag-published" style="background:#f0c14b;color:#5a3e00;">${escapeHtml(c.category)}</span>
      </div>
      <h1 style="font-size:28px;margin:0 0 14px;">${escapeHtml(c.title)}</h1>
      <div style="color:#95a5a6;font-size:13px;margin-bottom:20px;">${escapeHtml(c.created_at?.slice(0, 10) || '')}</div>
      ${img}
      <div class="summary-content" style="font-size:15px;">${bodyHtml}</div>
      ${link}
    </article>
  </main>
</body>
</html>`
}

export function renderUnsubscribePage(opts: { success: boolean; message: string }): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>구독 해지 | 모투스 위클리</title>
  <link href="/static/style.css" rel="stylesheet">
</head>
<body>
  <main class="container" style="padding-top:80px;text-align:center;">
    <div class="card" style="max-width:480px;margin:0 auto;padding:40px;">
      <div style="font-size:48px;margin-bottom:14px;">${opts.success ? '✅' : '⚠️'}</div>
      <h1 style="font-size:22px;margin:0 0 10px;">${opts.success ? '구독이 해지되었습니다' : '처리할 수 없습니다'}</h1>
      <p style="color:#7f8c8d;line-height:1.7;">${escapeHtml(opts.message)}</p>
      <div style="margin-top:24px;"><a href="/" class="btn">메인으로</a></div>
    </div>
  </main>
</body>
</html>`
}
