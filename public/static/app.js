// 메인 페이지 클라이언트 스크립트

const $ = (s, p = document) => p.querySelector(s)
const $$ = (s, p = document) => Array.from(p.querySelectorAll(s))

function toast(msg, type = '') {
  const el = document.createElement('div')
  el.className = 'toast ' + type
  el.textContent = msg
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 3000)
}

function escHtml(s) {
  if (!s) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function mdToHtml(md) {
  if (!md) return ''
  let html = md
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
  html = html.replace(/\n\n/g, '</p><p>')
  html = '<p>' + html + '</p>'
  html = html.replace(/<p>(<h[1-3]>)/g, '$1').replace(/(<\/h[1-3]>)<\/p>/g, '$1')
  html = html.replace(/<p>(<ul>)/g, '$1').replace(/(<\/ul>)<\/p>/g, '$1')
  html = html.replace(/<p><\/p>/g, '')
  return html
}

let allNews = []
let currentCat = '전체'
let currentSubCat = '전체'
let newsLimit = 15  // 기본 노출 개수
const NEWS_INITIAL_LIMIT = 15

// 카테고리 그룹 매핑 (서버와 동일 기준)
const CATEGORY_GROUP_MAP = {
  '분양': '부동산',
  '청약': '부동산',
  '정책': '부동산',
  '건설': '부동산',
  '재건축': '도시정비',
  '도시정비': '도시정비',
  'AI': 'AI',
  '옥외광고': '광고/매체',
  '디지털광고': '광고/매체',
  '광고산업': '광고/매체',
  '미디어': '광고/매체',
  '광고규제': '광고/매체'
}
// 광고/매체 하위 카테고리 목록
const AD_MEDIA_SUBCATS = ['옥외광고', '디지털광고', '광고산업', '미디어', '광고규제']
function categoryGroup(cat) {
  return CATEGORY_GROUP_MAP[cat] || '기타'
}

// ── H2 카테고리 헤딩 텍스트 → sectionKey 추정 (서버 inferSectionKeyFromHeading과 동일 로직)
function inferSectionKeyFromHeading(text) {
  const h = (text || '').toLowerCase()
  if (/도시\s*정비|재건축|재개발|정비\s*사업/.test(h)) return 'urban'
  if (/분양|청약/.test(h)) return 'sale'
  if (/건설사|시공사|건설\s*기술|건설사·기술|건설사\s*동향/.test(h)) return 'builder'
  if (/정책|시장|규제|금리|세제/.test(h)) return 'policy'
  if (/광고|매체|미디어|옥외|디지털\s*광고/.test(h)) return 'media'
  if (/회사|기업|자사|모투스/.test(h)) return 'company'
  return null
}

// ── summary HTML을 DOM 조작으로 H2 직후에 카테고리 대표 이미지 삽입
function injectSectionImagesIntoContainer(container, sectionImages) {
  if (!container || !sectionImages || !Object.keys(sectionImages).length) return
  const h2s = container.querySelectorAll('h2')
  h2s.forEach(h2 => {
    const text = (h2.textContent || '').trim()
    const sk = inferSectionKeyFromHeading(text)
    if (!sk) return
    const url = sectionImages[sk]
    if (!url) return
    // 중복 삽입 방지
    if (h2.nextElementSibling && h2.nextElementSibling.classList && h2.nextElementSibling.classList.contains('cat-img-wrap')) return
    const wrap = document.createElement('div')
    wrap.className = 'cat-img-wrap'
    const img = document.createElement('img')
    img.className = 'cat-img'
    img.src = url
    img.alt = text
    img.loading = 'lazy'
    wrap.appendChild(img)
    h2.insertAdjacentElement('afterend', wrap)
  })
}

async function loadToday() {
  const r = await fetch('/api/today').then(r => r.json())
  // 날짜
  $('#today-date').textContent = r.date
  $('#article-count').textContent = `총 ${r.articleCount}건`

  // 자사 콘텐츠
  renderCompanyContents(r.contents || [])

  // 요약
  const summaryHost = $('#summary-content')
  if (r.summary) {
    summaryHost.innerHTML = mdToHtml(r.summary)
    // 각 카테고리 H2 헤딩 바로 아래에 운영자 업로드 대표 이미지 삽입
    injectSectionImagesIntoContainer(summaryHost, r.sectionImages || {})
  } else {
    summaryHost.innerHTML = '<p style="color:#95a5a6;">아직 오늘의 요약이 생성되지 않았습니다. 잠시 후 다시 확인해주세요.</p>'
  }

  // 뉴스 카테고리 카운트
  allNews = r.news || []
  renderNews()
}

function renderCompanyContents(items) {
  const host = $('#company-section')
  if (!items.length) { host.style.display = 'none'; return }
  host.style.display = ''
  $('#company-grid').innerHTML = items.map(c => {
    const img = c.image_url
      ? `<img class="thumb" src="${escHtml(c.image_url)}" alt="">`
      : `<div class="thumb-fallback">🏢</div>`
    const summary = (c.body || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').slice(0, 80)
    const linkUrl = c.external_link
      ? `/c/${c.id}/click?source=web&redirect=${encodeURIComponent(c.external_link)}`
      : `/content/${c.id}`
    return `
      <a class="company-card" href="${linkUrl}" ${c.external_link ? 'target="_blank"' : ''} onclick="trackClick(${c.id})">
        ${img}
        <div class="body">
          <span class="badge">${escHtml(c.category)}</span>
          ${c.is_pinned ? '<span class="badge pin">📌 고정</span>' : ''}
          <h3>${escHtml(c.title)}</h3>
          <div class="summary">${escHtml(summary)}${summary.length >= 80 ? '...' : ''}</div>
          <div class="more">자세히 보기 →</div>
        </div>
      </a>
    `
  }).join('')
}

function filterNewsByCat(items, cat) {
  let filtered = items
  if (cat !== '전체') {
    filtered = filtered.filter(n => categoryGroup(n.category) === cat)
  }
  // 광고/매체 선택 시 하위 카테고리 추가 필터
  if (cat === '광고/매체' && currentSubCat && currentSubCat !== '전체') {
    filtered = filtered.filter(n => n.category === currentSubCat)
  }
  return filtered
}

function renderNews() {
  const filtered = filterNewsByCat(allNews, currentCat)
  const host = $('#news-list')
  if (!filtered.length) {
    host.innerHTML = '<div style="text-align:center;color:#95a5a6;padding:30px;">해당 카테고리의 뉴스가 없습니다.</div>'
    $('#news-more-wrap').style.display = 'none'
    $('#total-news-count').textContent = '0건'
    return
  }
  const visible = filtered.slice(0, newsLimit)
  host.innerHTML = visible.map(n => `
    <div class="news-item">
      <div class="news-meta">
        <span class="cat-badge">${escHtml(n.category)}</span>
        <span>${escHtml(n.source || '-')}</span>
        <span style="color:#bdc3c7;margin-left:auto;font-size:11px;">${(n.pub_date || '').slice(0, 10)}</span>
      </div>
      <h4><a href="${escHtml(n.link)}" target="_blank" rel="noopener">${escHtml(n.title)}</a></h4>
      <div class="desc">${escHtml((n.description || '').slice(0, 150))}</div>
    </div>
  `).join('')

  const remain = Math.max(0, filtered.length - visible.length)
  $('#total-news-count').textContent = `${visible.length} / 총 ${filtered.length}건`
  if (remain > 0) {
    $('#news-more-wrap').style.display = ''
    $('#news-remain').textContent = String(remain)
  } else {
    $('#news-more-wrap').style.display = 'none'
  }
}

function setCategory(cat) {
  currentCat = cat
  currentSubCat = '전체'  // 메인 카테고리 변경 시 하위 카테고리 초기화
  newsLimit = NEWS_INITIAL_LIMIT  // 카테고리 변경 시 다시 15건부터
  // 메인 필터 버튼 활성화 (sub-cat-filter는 제외)
  $$('.cat-filter:not(.sub-cat-filter) button').forEach(b => b.classList.toggle('active', b.dataset.cat === cat))
  // 광고/매체 선택 시 하위 카테고리 필터 표시
  const subFilter = $('#sub-cat-filter')
  if (subFilter) {
    if (cat === '광고/매체') {
      subFilter.style.display = ''
      // 하위 필터도 '전체'로 리셋
      $$('#sub-cat-filter button').forEach(b => b.classList.toggle('active', b.dataset.subcat === '전체'))
    } else {
      subFilter.style.display = 'none'
    }
  }
  renderNews()
}

function setSubCategory(subcat) {
  currentSubCat = subcat
  newsLimit = NEWS_INITIAL_LIMIT
  $$('#sub-cat-filter button').forEach(b => b.classList.toggle('active', b.dataset.subcat === subcat))
  renderNews()
}

function showMoreNews() {
  const filtered = filterNewsByCat(allNews, currentCat)
  newsLimit = Math.min(filtered.length, newsLimit + 30)  // 30개씩 추가
  renderNews()
}

function escapeHtml(s) {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

async function subscribe(e) {
  e.preventDefault()
  const email = $('#sub-email').value.trim()
  const name = $('#sub-name').value.trim()
  if (!email) { toast('이메일을 입력해주세요.', 'error'); return }
  const btn = $('#sub-btn')
  btn.disabled = true
  try {
    const r = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, name })
    }).then(r => r.json())
    if (r.error) { toast(r.error, 'error'); return }
    toast('구독 신청이 완료되었습니다! 🎉', 'success')
    $('#sub-email').value = ''
    $('#sub-name').value = ''
  } catch (e) {
    toast('네트워크 오류', 'error')
  } finally {
    btn.disabled = false
  }
}

async function manualCollect() {
  const btn = $('#collect-btn')
  if (!confirm('지금 즉시 뉴스를 새로 수집하고 AI 요약을 생성합니다. 시간이 걸릴 수 있어요. 진행할까요?')) return
  btn.disabled = true
  btn.textContent = '⏳ 수집 중...'
  try {
    const r = await fetch('/api/collect', { method: 'POST' }).then(r => r.json())
    if (r.error) { toast(r.error, 'error'); return }
    toast(`수집 완료: ${r.newsCollected}건`, 'success')
    await loadToday()
  } catch (e) {
    toast('실패: ' + e.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = '🔄 지금 새로 수집하기'
  }
}

window.trackClick = function(id) {
  fetch(`/api/content/${id}/click`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'web' })
  }).catch(() => {})
}

document.addEventListener('DOMContentLoaded', () => {
  // 메인 카테고리 버튼 (sub-cat-filter 제외)
  $$('.cat-filter:not(.sub-cat-filter) button').forEach(b => b.addEventListener('click', () => setCategory(b.dataset.cat)))
  // 하위 카테고리 버튼
  $$('#sub-cat-filter button').forEach(b => b.addEventListener('click', () => setSubCategory(b.dataset.subcat)))
  $('#sub-form')?.addEventListener('submit', subscribe)
  $('#collect-btn')?.addEventListener('click', manualCollect)
  $('#news-more-btn')?.addEventListener('click', showMoreNews)
  loadToday()
})
