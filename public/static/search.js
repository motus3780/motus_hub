// 뉴스 검색 페이지 클라이언트 스크립트
const $ = (s, p = document) => p.querySelector(s)
const $$ = (s, p = document) => Array.from(p.querySelectorAll(s))

function escHtml(s) {
  if (!s) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

let currentPage = 1

function getFilters() {
  const subcatEl = $('#sf-subcat')
  return {
    q: $('#sf-q').value.trim(),
    group: $('#sf-group').value,
    subcat: subcatEl ? subcatEl.value : '',
    period: $('#sf-period').value,
    start: $('#sf-start').value,
    end: $('#sf-end').value,
    source: $('#sf-source').value,
    sort: $('#sf-sort').value
  }
}

function toggleSubcatWrap() {
  const wrap = $('#sf-subcat-wrap')
  if (!wrap) return
  const group = $('#sf-group').value
  if (group === '광고/매체') {
    wrap.style.display = ''
  } else {
    wrap.style.display = 'none'
    const sel = $('#sf-subcat')
    if (sel) sel.value = ''
  }
}

function periodToDates(period) {
  const today = new Date()
  const fmt = (d) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
  }
  if (period === 'today') return { start: fmt(today), end: fmt(today) }
  if (period === '7' || period === '30' || period === '90') {
    const past = new Date(today)
    past.setDate(past.getDate() - parseInt(period))
    return { start: fmt(past), end: fmt(today) }
  }
  return { start: '', end: '' }
}

// 관리자 페이지에서 호출되면 admin API, 공개 페이지면 공개 API
const IS_ADMIN = location.pathname.startsWith('/admin')
const SEARCH_BASE = IS_ADMIN ? '/admin/api' : '/api'

async function loadSources() {
  try {
    const r = await fetch(SEARCH_BASE + '/news-sources').then(r => r.json())
    const select = $('#sf-source')
    for (const s of (r.items || [])) {
      const opt = document.createElement('option')
      opt.value = s
      opt.textContent = s
      select.appendChild(opt)
    }
  } catch (e) {}
}

async function runSearch(page = 1) {
  currentPage = page
  const f = getFilters()
  let start = f.start
  let end = f.end
  if (f.period && f.period !== 'custom') {
    const d = periodToDates(f.period)
    start = d.start
    end = d.end
  }

  const params = new URLSearchParams()
  if (f.q) params.set('q', f.q)
  if (f.group) params.set('group', f.group)
  // 하위 카테고리가 설정되면 category 파라미터로 직접 전달
  if (f.subcat) params.set('category', f.subcat)
  if (f.source) params.set('source', f.source)
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  if (f.sort) params.set('sort', f.sort)
  params.set('page', String(page))
  params.set('pageSize', '20')

  $('#search-meta').textContent = '⏳ 검색 중...'
  $('#search-results').innerHTML = ''
  $('#search-pagination').innerHTML = ''

  try {
    const r = await fetch('/api/news/search?' + params.toString()).then(r => r.json())
    renderResults(r)
  } catch (e) {
    $('#search-meta').textContent = '❌ 검색 실패'
  }
}

function renderResults(r) {
  const total = r.total || 0
  const items = r.items || []
  $('#search-meta').textContent = total > 0
    ? `총 ${total}건 · ${r.page}/${r.totalPages} 페이지`
    : '검색 결과가 없습니다.'

  if (!items.length) {
    $('#search-results').innerHTML = '<div style="text-align:center;color:#95a5a6;padding:40px;">검색 결과가 없습니다. 다른 키워드/필터를 시도해보세요.</div>'
    return
  }

  $('#search-results').innerHTML = items.map(n => `
    <div class="news-item">
      <div class="news-meta">
        <span class="cat-badge">${escHtml(n.category)}</span>
        <span>${escHtml(n.source || '-')}</span>
        <span style="color:#bdc3c7;margin-left:auto;font-size:11px;">${(n.pub_date || '').slice(0, 10)} · 수집 ${(n.collection_date || '').slice(0, 10)}</span>
      </div>
      <h4><a href="${escHtml(n.link)}" target="_blank" rel="noopener">${escHtml(n.title)}</a></h4>
      <div class="desc">${escHtml((n.description || '').slice(0, 220))}</div>
    </div>
  `).join('')

  // 페이지네이션
  renderPagination(r.page, r.totalPages)
}

function renderPagination(page, totalPages) {
  if (totalPages <= 1) { $('#search-pagination').innerHTML = ''; return }
  const buttons = []
  buttons.push(`<button ${page === 1 ? 'disabled' : ''} data-page="${page - 1}">‹ 이전</button>`)

  // 표시할 페이지 범위 (현재 페이지 ±2)
  const start = Math.max(1, page - 2)
  const end = Math.min(totalPages, page + 2)
  if (start > 1) {
    buttons.push(`<button data-page="1">1</button>`)
    if (start > 2) buttons.push(`<span class="page-ellipsis">…</span>`)
  }
  for (let p = start; p <= end; p++) {
    buttons.push(`<button class="${p === page ? 'active' : ''}" data-page="${p}">${p}</button>`)
  }
  if (end < totalPages) {
    if (end < totalPages - 1) buttons.push(`<span class="page-ellipsis">…</span>`)
    buttons.push(`<button data-page="${totalPages}">${totalPages}</button>`)
  }
  buttons.push(`<button ${page === totalPages ? 'disabled' : ''} data-page="${page + 1}">다음 ›</button>`)
  $('#search-pagination').innerHTML = buttons.join('')

  $$('#search-pagination button').forEach(b => {
    b.addEventListener('click', () => {
      const p = parseInt(b.dataset.page)
      if (!isNaN(p)) runSearch(p)
    })
  })
}

document.addEventListener('DOMContentLoaded', () => {
  loadSources()
  // URL 쿼리에서 q 미리 채우기
  const sp = new URLSearchParams(location.search)
  if (sp.get('q')) $('#sf-q').value = sp.get('q')
  if (sp.get('group')) $('#sf-group').value = sp.get('group')
  if (sp.get('category') && $('#sf-subcat')) $('#sf-subcat').value = sp.get('category')
  toggleSubcatWrap()

  $('#search-form').addEventListener('submit', (e) => { e.preventDefault(); runSearch(1) })
  $('#sf-period').addEventListener('change', () => {
    const v = $('#sf-period').value
    $$('.sf-custom').forEach(el => el.style.display = v === 'custom' ? '' : 'none')
  })
  $('#sf-group').addEventListener('change', toggleSubcatWrap)

  // 초기 진입 시 빈 검색으로 최근 뉴스 표시
  runSearch(1)
})
