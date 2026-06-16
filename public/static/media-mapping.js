// 언론사 매핑 관리 페이지 클라이언트 스크립트
const $ = (s, p = document) => p.querySelector(s)
const $$ = (s, p = document) => Array.from(p.querySelectorAll(s))

function escHtml(s) {
  if (!s) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

async function api(path, opts = {}) {
  const r = await fetch('/admin/api' + path, {
    credentials: 'include',
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    ...opts
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || '요청 실패')
  return data
}

async function loadMappings() {
  try {
    const r = await api('/media-mapping')
    renderCustom(r.custom || {})
    renderDefaults(r.defaults || {})
  } catch (e) {
    alert('매핑 로드 실패: ' + e.message)
  }
}

function renderCustom(custom) {
  const entries = Object.entries(custom)
  const tbody = $('#mm-custom-tbody')
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#95a5a6;padding:20px;">사용자 추가 매핑이 없습니다.</td></tr>'
    return
  }
  tbody.innerHTML = entries.map(([d, n]) => `
    <tr>
      <td><code style="background:#f8fafc;padding:2px 6px;border-radius:4px;">${escHtml(d)}</code></td>
      <td><input data-domain="${escHtml(d)}" class="mm-name-input" value="${escHtml(n)}" style="width:100%;padding:6px 10px;border:1px solid #dfe6ed;border-radius:6px;"></td>
      <td>
        <button class="btn btn-sm" onclick="updateMapping('${escHtml(d)}')">저장</button>
        <button class="btn btn-sm btn-danger" onclick="removeMapping('${escHtml(d)}')">삭제</button>
      </td>
    </tr>
  `).join('')
}

function renderDefaults(defaults) {
  const entries = Object.entries(defaults).sort(([a], [b]) => a.localeCompare(b))
  $('#mm-default-tbody').innerHTML = entries.map(([d, n]) => `
    <tr>
      <td><code style="background:#f8fafc;padding:2px 6px;border-radius:4px;">${escHtml(d)}</code></td>
      <td>${escHtml(n)}</td>
    </tr>
  `).join('')
}

window.updateMapping = async function(domain) {
  const input = $(`.mm-name-input[data-domain="${domain}"]`)
  if (!input) return
  const name = input.value.trim()
  if (!name) { alert('언론사명을 입력하세요.'); return }
  try {
    await api('/media-mapping/add', {
      method: 'POST',
      body: JSON.stringify({ domain, name })
    })
    showResult('✅ 저장되었습니다.', 'success')
    await loadMappings()
  } catch (e) {
    showResult('❌ ' + e.message, 'error')
  }
}

window.removeMapping = async function(domain) {
  if (!confirm(`"${domain}" 매핑을 삭제할까요?`)) return
  try {
    await api('/media-mapping/' + encodeURIComponent(domain), { method: 'DELETE' })
    showResult('✅ 삭제되었습니다.', 'success')
    await loadMappings()
  } catch (e) {
    showResult('❌ ' + e.message, 'error')
  }
}

function showResult(msg, type) {
  const el = $('#mm-add-result')
  el.style.color = type === 'success' ? '#27ae60' : '#e74c3c'
  el.textContent = msg
  setTimeout(() => { el.textContent = '' }, 3000)
}

document.addEventListener('DOMContentLoaded', () => {
  loadMappings()
  $('#mm-add-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const domain = $('#mm-domain').value.trim()
    const name = $('#mm-name').value.trim()
    if (!domain || !name) return
    try {
      await api('/media-mapping/add', {
        method: 'POST',
        body: JSON.stringify({ domain, name })
      })
      showResult(`✅ "${domain}" → "${name}" 추가됨`, 'success')
      $('#mm-domain').value = ''
      $('#mm-name').value = ''
      await loadMappings()
    } catch (e) {
      showResult('❌ ' + e.message, 'error')
    }
  })
})
