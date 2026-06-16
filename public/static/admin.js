// 관리자 콘솔 클라이언트 스크립트

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
  if (s === null || s === undefined) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

async function api(path, opts = {}) {
  const o = { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } }
  if (o.body && typeof o.body !== 'string') o.body = JSON.stringify(o.body)
  const r = await fetch('/admin/api' + path, o)
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
  return data
}

window.logout = async function() {
  await fetch('/admin/api/logout', { method: 'POST' })
  location.href = '/admin/login'
}

// ===== 대시보드 =====
async function loadDashboard() {
  try {
    const r = await api('/dashboard')
    const ctr = r.contentStats.views > 0 ? ((r.contentStats.clicks / r.contentStats.views) * 100).toFixed(1) : '0.0'
    $('#dashboard-stats').innerHTML = `
      <div class="stat-card"><div class="label">전체 구독자</div><div class="value">${r.subscribers.total}</div><div class="sub">활성 ${r.subscribers.active}명</div></div>
      <div class="stat-card"><div class="label">오늘 발송 성공</div><div class="value">${r.todaySend.success}</div><div class="sub">실패 ${r.todaySend.failed}건</div></div>
      <div class="stat-card"><div class="label">자사 콘텐츠</div><div class="value">${r.contentStats.total}</div><div class="sub">발행 중</div></div>
      <div class="stat-card"><div class="label">노출/클릭 (CTR)</div><div class="value">${r.contentStats.views} / ${r.contentStats.clicks}</div><div class="sub">CTR ${ctr}%</div></div>
    `
    drawTrend(r.trend || [])
    // 자동 실행 상태 + 로그
    loadAutoJobBadge()
    loadAutoJobLogs()
  } catch (e) { toast(e.message, 'error') }
}

// ===== 자동 실행 배지 =====
async function loadAutoJobBadge() {
  const el = $('#auto-job-badge')
  if (!el) return
  try {
    const r = await api('/auto-job/status')
    const today = r.today || {}
    const last = r.lastResult || {}
    const next = r.nextRun || {}
    const cfg = r.config || {}

    let cls = 'auto-badge-info'
    let icon = '⏳'
    let text = ''

    const cDone = today.collectCompleted
    const sDone = today.sendCompleted
    const cLast = last.collect
    const sLast = last.send

    // 가장 최근 실행이 실패였는지 확인
    const recentFailed = (cLast && cLast.status === 'failed' && isToday(cLast.started_at)) ||
                        (sLast && sLast.status === 'failed' && isToday(sLast.started_at))

    if (recentFailed) {
      cls = 'auto-badge-error'
      icon = '❌'
      const which = (cLast && cLast.status === 'failed') ? '수집·요약' : '발송'
      text = `자동 실행 실패 (${which}) — 수동 재실행 필요`
      el.className = 'auto-badge ' + cls
      el.innerHTML = `
        <span class="auto-badge-icon">${icon}</span>
        <span class="auto-badge-text">${escHtml(text)}</span>
        <button class="btn btn-sm btn-warning" style="margin-left:auto;" onclick="runCollect()">재실행</button>
      `
      return
    }

    if (cDone && sDone) {
      cls = 'auto-badge-success'
      icon = '✅'
      const cTime = cLast ? formatTimeOnly(cLast.finished_at || cLast.started_at) : ''
      const sTime = sLast ? formatTimeOnly(sLast.finished_at || sLast.started_at) : ''
      text = `오늘 수집·요약 완료 (${cTime}) | 발송 완료 (${sTime})`
    } else if (cDone && !sDone) {
      cls = 'auto-badge-info'
      icon = '⏳'
      const cTime = cLast ? formatTimeOnly(cLast.finished_at || cLast.started_at) : ''
      text = `수집·요약 완료 (${cTime}) · 발송 대기 중 (${cfg.sendTime || '07:30'} 예정)`
    } else if (!cDone && sDone) {
      cls = 'auto-badge-info'
      icon = '⚠️'
      text = `발송은 완료되었으나 수집 기록 없음 — 데이터 확인 필요`
    } else {
      cls = 'auto-badge-info'
      icon = '⏳'
      text = `수집·요약 대기 중 (${cfg.collectTime || '06:30'} 예정)`
    }
    el.className = 'auto-badge ' + cls
    el.innerHTML = `
      <span class="auto-badge-icon">${icon}</span>
      <span class="auto-badge-text">${escHtml(text)}</span>
    `
  } catch (e) {
    el.className = 'auto-badge auto-badge-info'
    el.innerHTML = `<span class="auto-badge-icon">⚠️</span><span class="auto-badge-text">자동 실행 상태 조회 실패: ${escHtml(e.message)}</span>`
  }
}

// ===== KST 표시 헬퍼 (UTC ISO → KST 표시) =====
// DB는 모두 UTC ISO 8601 ("YYYY-MM-DDTHH:mm:ss.sssZ") 로 저장하므로,
// 화면 표시는 반드시 이 헬퍼를 거쳐 KST로 변환한다.
//
// 입력 형식 허용:
//   - "2026-06-15T06:58:23.323Z"  (UTC ISO, 정식)
//   - "2026-06-15 06:58:23"       (UTC, SQLite CURRENT_TIMESTAMP 기본값 — 'Z' 없음)
//   - "2026-06-15"                (날짜만)
// 반환 형식:
//   - formatKST(s, 'minute') → "06-15 15:58 KST"
//   - formatKST(s, 'second') → "2026-06-15 15:58:23 KST"
//   - formatKST(s, 'date')   → "2026-06-15"   (KST 달력일)
function formatKST(s, mode) {
  if (!s) return ''
  let str = String(s).trim()
  if (!str) return ''
  // "YYYY-MM-DD HH:mm:ss" 형식이면 UTC 로 해석하기 위해 'T' + 'Z' 부여
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(str)) {
    str = str.replace(' ', 'T') + 'Z'
  }
  const t = new Date(str).getTime()
  if (Number.isNaN(t)) return String(s) // 파싱 실패 시 원본 그대로
  const k = new Date(t + 9 * 60 * 60 * 1000)
  const y = k.getUTCFullYear()
  const m = String(k.getUTCMonth() + 1).padStart(2, '0')
  const d = String(k.getUTCDate()).padStart(2, '0')
  const hh = String(k.getUTCHours()).padStart(2, '0')
  const mi = String(k.getUTCMinutes()).padStart(2, '0')
  const ss = String(k.getUTCSeconds()).padStart(2, '0')
  if (mode === 'date') return `${y}-${m}-${d}`
  if (mode === 'second') return `${y}-${m}-${d} ${hh}:${mi}:${ss} KST`
  if (mode === 'time-only') return `${hh}:${mi} KST`
  // 기본 = minute
  return `${m}-${d} ${hh}:${mi} KST`
}

// 오늘(KST)에 해당하는지 검사 — UTC ISO 또는 KST 문자열 모두 지원
function isToday(s) {
  if (!s) return false
  const kstToday = formatKST(new Date().toISOString(), 'date')
  return formatKST(s, 'date') === kstToday
}

// 시간만 추출 (KST HH:mm) — 자동 실행 배지 등에 사용
function formatTimeOnly(s) {
  if (!s) return ''
  return formatKST(s, 'time-only')
}

async function loadAutoJobLogs() {
  const tbody = $('#auto-job-logs-tbody')
  if (!tbody) return
  try {
    const r = await api('/auto-job/logs?limit=20')
    const logs = r.logs || []
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#95a5a6;padding:24px;">자동 실행 기록이 없습니다.</td></tr>'
      return
    }
    tbody.innerHTML = logs.map(l => {
      const typeLabel = l.job_type === 'collect' ? '수집·요약' : '발송'
      const trgLabel = l.trigger_type === 'cron' ? '🤖 자동' : (l.trigger_type === 'cron-test' ? '🧪 테스트' : '👤 수동')
      const stColor = { success: '#27ae60', partial: '#f39c12', failed: '#e74c3c', skipped: '#95a5a6' }[l.status] || '#7f8c8d'
      const stIcon = { success: '✅', partial: '⚠️', failed: '❌', skipped: '⏭️' }[l.status] || '•'
      let proc = ''
      if (l.job_type === 'collect') {
        proc = `${l.news_collected}건 수집`
      } else {
        proc = `${l.emails_sent}/${l.emails_sent + l.emails_failed} 발송`
      }
      const attempt = l.attempt > 1 ? ` <span style="font-size:10px;color:#e67e22;">(${l.attempt}회 시도)</span>` : ''
      return `
        <tr>
          <td style="font-size:12px;font-family:monospace;" title="UTC: ${escHtml(l.started_at || '')}">${escHtml(formatKST(l.started_at, 'second'))}</td>
          <td>${escHtml(typeLabel)}</td>
          <td style="font-size:12px;">${escHtml(trgLabel)}</td>
          <td style="color:${stColor};font-weight:700;">${stIcon} ${escHtml(l.status)}${attempt}</td>
          <td style="font-size:13px;">${escHtml(proc)}</td>
          <td style="font-size:11px;color:#e74c3c;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(l.error_message || '')}">${escHtml((l.error_message || '').slice(0, 60))}</td>
        </tr>
      `
    }).join('')
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:#e74c3c;">${escHtml(e.message)}</td></tr>`
  }
}

// ===== Cron 테스트 실행 =====
window.runCronTest = async function(type) {
  const label = type === 'collect' ? '수집·요약' : '발송'
  if (!confirm(`Cron 테스트 (${label})를 즉시 실행합니다. 자동 실행과 동일한 로직으로 동작하며 로그에 'cron-test'로 기록됩니다. 진행할까요?`)) return
  $('#run-result').innerHTML = `<div style="background:#eaf2fb;color:#2c3e50;padding:12px;border-radius:8px;">⏳ Cron 테스트 (${label}) 실행 중...</div>`
  try {
    const r = await api(`/auto-job/test/${type}`, { method: 'POST' })
    const log = r.log || {}
    const stColor = { success: '#27ae60', partial: '#f39c12', failed: '#e74c3c', skipped: '#95a5a6' }[log.status] || '#7f8c8d'
    const stIcon = { success: '✅', partial: '⚠️', failed: '❌', skipped: '⏭️' }[log.status] || '•'
    let detail = ''
    if (type === 'collect') detail = `${log.news_collected || 0}건 수집`
    else detail = `${log.emails_sent || 0}/${(log.emails_sent || 0) + (log.emails_failed || 0)} 발송`
    let html = `<div style="background:#e8f8ee;color:${stColor};padding:12px;border-radius:8px;">${stIcon} Cron 테스트 (${label}) 완료 — <strong>${log.status}</strong> · ${detail} · 시도 ${log.attempt || 1}회</div>`
    if (log.error_message) {
      html += `<div style="background:#fff3e0;color:#7d4f00;padding:10px;border-radius:8px;margin-top:8px;font-size:12px;font-family:monospace;white-space:pre-wrap;word-break:break-all;">${escHtml(log.error_message)}</div>`
    }
    $('#run-result').innerHTML = html
    loadAutoJobBadge()
    loadAutoJobLogs()
    loadDashboard()
  } catch (e) {
    $('#run-result').innerHTML = `<div style="background:#fce4e4;color:#e74c3c;padding:12px;border-radius:8px;">❌ ${escHtml(e.message)}</div>`
  }
}

function drawTrend(trend) {
  const canvas = $('#trend-chart')
  if (!canvas) return
  // 날짜별 집계
  const byDate = {}
  for (const t of trend) {
    if (!byDate[t.send_date]) byDate[t.send_date] = { success: 0, failed: 0 }
    byDate[t.send_date][t.status] = t.cnt
  }
  const dates = Object.keys(byDate).sort()
  if (!dates.length) {
    const ctx = canvas.getContext('2d')
    canvas.width = canvas.offsetWidth; canvas.height = 240
    ctx.fillStyle = '#95a5a6'; ctx.font = '14px Pretendard'
    ctx.textAlign = 'center'
    ctx.fillText('아직 발송 데이터가 없습니다.', canvas.width / 2, canvas.height / 2)
    return
  }
  const w = canvas.offsetWidth, h = 240
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  const maxV = Math.max(...dates.map(d => byDate[d].success + byDate[d].failed), 1)
  const padL = 40, padR = 20, padT = 20, padB = 40
  const chartW = w - padL - padR, chartH = h - padT - padB
  const barW = chartW / dates.length * 0.6
  const stepX = chartW / dates.length
  // 배경 그리드
  ctx.strokeStyle = '#ecf0f1'; ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const y = padT + (chartH * i / 4)
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke()
    ctx.fillStyle = '#95a5a6'; ctx.font = '11px Pretendard'; ctx.textAlign = 'right'
    ctx.fillText(Math.round(maxV * (1 - i / 4)), padL - 6, y + 3)
  }
  // 막대
  dates.forEach((d, i) => {
    const v = byDate[d]
    const x = padL + i * stepX + (stepX - barW) / 2
    const totalH = (v.success + v.failed) / maxV * chartH
    const successH = v.success / maxV * chartH
    // 실패 (위)
    ctx.fillStyle = '#e74c3c'
    ctx.fillRect(x, padT + chartH - totalH, barW, totalH - successH)
    // 성공 (아래)
    ctx.fillStyle = '#27ae60'
    ctx.fillRect(x, padT + chartH - successH, barW, successH)
    // X축 라벨
    ctx.fillStyle = '#7f8c8d'; ctx.font = '11px Pretendard'; ctx.textAlign = 'center'
    ctx.fillText(d.slice(5), x + barW / 2, h - padB + 16)
  })
}

window.runCollect = async function() {
  // 오늘 이미 자동으로 수집·요약이 완료되었는지 확인
  try {
    const st = await api('/auto-job/status')
    if (st.today && st.today.collectCompleted) {
      if (!confirm('이미 오늘 자동으로 수집·요약이 실행되었습니다. 다시 실행하시겠습니까? (기존 데이터에 추가됩니다)')) return
    } else {
      if (!confirm('지금 뉴스 수집과 AI 요약을 실행합니다 (이메일 발송은 안 함). 진행할까요?')) return
    }
  } catch (e) {
    if (!confirm('지금 뉴스 수집과 AI 요약을 실행합니다 (이메일 발송은 안 함). 진행할까요?')) return
  }
  $('#run-result').innerHTML = '⏳ 실행 중...'
  try {
    const r = await api('/collect-now', { method: 'POST' })
    $('#run-result').innerHTML = `<div style="background:#e8f8ee;color:#27ae60;padding:12px;border-radius:8px;">✅ 수집 ${r.newsCollected}건, 요약 ${r.summaryGenerated ? '성공' : '실패'} ${r.errors.length ? '<br>오류: ' + escHtml(r.errors.join(', ')) : ''}</div>`
    loadAutoJobBadge()
    loadAutoJobLogs()
  } catch (e) {
    $('#run-result').innerHTML = `<div style="background:#fce4e4;color:#e74c3c;padding:12px;border-radius:8px;">❌ ${escHtml(e.message)}</div>`
  }
}

window.runDaily = async function() {
  // 오늘 이미 발송이 완료되었는지 확인 → 완료된 경우 'force' 재발송 의사 확인
  let force = false
  try {
    const st = await api('/auto-job/status')
    if (st.today && st.today.sendCompleted) {
      const msg =
        '⚠️ 오늘 이미 발송이 완료되었습니다.\n\n' +
        '"확인"을 누르시면 멱등성 차단을 우회하여 모든 활성 구독자에게 다시 발송합니다.\n' +
        '(같은 구독자에게 같은 날 2통 이상이 갈 수 있습니다.)\n\n' +
        '재발송을 진행할까요?'
      if (!confirm(msg)) return
      force = true
    } else {
      if (!confirm('지금 즉시 전체 활성 구독자에게 이메일을 발송합니다. 진행할까요?')) return
    }
  } catch (e) {
    if (!confirm('지금 즉시 전체 활성 구독자에게 이메일을 발송합니다. 진행할까요?')) return
  }

  const headerMsg = force
    ? '⏳ 재발송 준비 중... (멱등성 우회 모드)'
    : '⏳ 발송 준비 중...'
  $('#run-result').innerHTML = `<div style="background:#eaf2fb;color:#2c3e50;padding:12px;border-radius:8px;">${headerMsg}</div>`

  // 폴링 시작 (1초 간격) — 백엔드의 send_progress를 표시
  let pollTimer = setInterval(async () => {
    try {
      const p = await api('/send-progress')
      if (p.progress) {
        renderProgress(p.progress)
      }
    } catch (e) { /* ignore */ }
  }, 1000)

  try {
    const r = await api('/run-daily', { method: 'POST', body: { force } })
    clearInterval(pollTimer)

    // 최종 진행 상태 한 번 더 조회 후 결과 표시
    const forceLabel = force ? ' (재발송 / 멱등성 우회)' : ''
    let html = `<div style="background:#e8f8ee;color:#27ae60;padding:12px;border-radius:8px;">✅ 발송 완료${forceLabel} — 성공 ${r.emailsSent}건 / 실패 ${r.emailsFailed}건 (총 ${r.emailsSent + r.emailsFailed}건)</div>`
    if (r.errors && r.errors.length) {
      html += `<div style="background:#fff3e0;color:#7d4f00;padding:12px;border-radius:8px;margin-top:8px;font-size:12px;font-family:monospace;white-space:pre-wrap;word-break:break-all;"><strong>Resend 오류 응답 (전체):</strong>\n${escHtml(r.errors.join('\n'))}</div>`
    }
    $('#run-result').innerHTML = html
    loadDashboard()
    // 발송 이력 표가 화면에 있으면 즉시 갱신
    if (typeof window.loadSendJobs === 'function' && document.getElementById('send-jobs-tbody')) {
      window.loadSendJobs()
    }
  } catch (e) {
    clearInterval(pollTimer)
    $('#run-result').innerHTML = `<div style="background:#fce4e4;color:#e74c3c;padding:12px;border-radius:8px;font-family:monospace;white-space:pre-wrap;word-break:break-all;">❌ ${escHtml(e.message)}</div>`
  }
}

function renderProgress(p) {
  const total = p.total || 0
  const cur = p.current || 0
  const sent = p.sent || 0
  const failed = p.failed || 0
  const pct = total > 0 ? Math.round((cur / total) * 100) : 0
  const status = p.running ? '발송 중' : '완료'
  const currentLine = p.currentEmail && p.running ? `<div style="font-size:12px;color:#5a6878;margin-top:4px;">현재: ${escHtml(p.currentEmail)}</div>` : ''
  const html = `
    <div style="background:#eaf2fb;color:#2c3e50;padding:14px;border-radius:8px;border:1px solid #d0e2f5;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong>📤 ${cur}/${total} 발송 중...</strong>
        <span style="font-size:12px;color:#27ae60;">✅ ${sent} / <span style="color:#e74c3c;">❌ ${failed}</span></span>
      </div>
      <div style="background:#fff;border-radius:6px;height:10px;overflow:hidden;border:1px solid #d0e2f5;">
        <div style="background:linear-gradient(90deg,#3498db,#2c3e50);height:100%;width:${pct}%;transition:width 0.3s;"></div>
      </div>
      <div style="font-size:11px;color:#7f8c8d;margin-top:6px;">${pct}% · ${status}</div>
      ${currentLine}
    </div>
  `
  $('#run-result').innerHTML = html
}

window.testSend = async function() {
  const to = $('#test-send-to').value.trim()
  if (!to) { toast('수신 이메일을 입력하세요.', 'error'); return }
  $('#test-send-result').innerHTML = '⏳ 발송 중...'
  try {
    const r = await fetch('/admin/api/test-send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to })
    })
    const data = await r.json().catch(() => ({}))
    if (data.success) {
      $('#test-send-result').innerHTML = `<div style="background:#e8f8ee;color:#27ae60;padding:12px;border-radius:8px;">✅ 발송 성공! (Resend ID: ${escHtml(data.id || '-')})<br>받은 편지함을 확인해주세요.</div>`
    } else {
      $('#test-send-result').innerHTML = `<div style="background:#fce4e4;color:#e74c3c;padding:12px;border-radius:8px;font-family:monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;"><strong>❌ Resend 응답 (원문):</strong>\n${escHtml(data.error || JSON.stringify(data))}</div>`
    }
  } catch (e) {
    $('#test-send-result').innerHTML = `<div style="background:#fce4e4;color:#e74c3c;padding:12px;border-radius:8px;font-family:monospace;">❌ ${escHtml(e.message)}</div>`
  }
}

// ===== 콘텐츠 목록 =====
window.loadContents = async function() {
  try {
    const params = new URLSearchParams()
    if ($('#filter-search').value) params.set('search', $('#filter-search').value)
    if ($('#filter-category').value) params.set('category', $('#filter-category').value)
    if ($('#filter-status').value) params.set('status', $('#filter-status').value)
    const r = await api('/contents?' + params)
    const today = new Date().toISOString().slice(0, 10)
    $('#contents-tbody').innerHTML = r.items.map(c => {
      let statusTag = c.status === 'published' ? '<span class="tag tag-published">발행</span>' : '<span class="tag tag-draft">임시저장</span>'
      if (c.status === 'published' && c.end_date && c.end_date < today) {
        statusTag = '<span class="tag tag-expired">만료</span>'
      }
      const period = (c.start_date || '∞') + ' ~ ' + (c.end_date || '∞')
      return `
        <tr>
          <td><strong>${escHtml(c.title)}</strong></td>
          <td>${escHtml(c.category)}</td>
          <td>${statusTag}</td>
          <td style="font-size:12px;">${period}</td>
          <td>${c.show_in_email ? '✅' : '—'}</td>
          <td>${c.is_pinned ? '📌' : '—'}</td>
          <td>${c.view_count} / ${c.click_count}</td>
          <td style="white-space:nowrap;">
            <a href="/admin/contents/${c.id}/edit" class="btn btn-secondary btn-sm">수정</a>
            <button class="btn btn-secondary btn-sm" onclick="duplicateContent(${c.id})">복제</button>
            <button class="btn btn-danger btn-sm" onclick="deleteContent(${c.id})">삭제</button>
          </td>
        </tr>
      `
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:#95a5a6;padding:30px;">등록된 콘텐츠가 없습니다.</td></tr>'
  } catch (e) { toast(e.message, 'error') }
}

window.deleteContent = async function(id) {
  if (!confirm('정말 삭제하시겠어요?')) return
  try { await api('/contents/' + id, { method: 'DELETE' }); toast('삭제됨', 'success'); loadContents() }
  catch (e) { toast(e.message, 'error') }
}

window.duplicateContent = async function(id) {
  try { await api('/contents/' + id + '/duplicate', { method: 'POST' }); toast('복제됨', 'success'); loadContents() }
  catch (e) { toast(e.message, 'error') }
}

// ===== 콘텐츠 편집 =====
async function initContentForm() {
  const form = $('#content-form')
  if (!form) return
  const id = form.elements.id.value
  if (id) {
    const r = await api('/contents/' + id)
    const item = r.item
    form.elements.title.value = item.title || ''
    form.elements.category.value = item.category || '신규 상품'
    form.elements.body.value = item.body || ''
    form.elements.image_url.value = item.image_url || ''
    form.elements.external_link.value = item.external_link || ''
    form.elements.start_date.value = item.start_date || ''
    form.elements.end_date.value = item.end_date || ''
    form.elements.show_in_email.checked = item.show_in_email === 1
    form.elements.is_pinned.checked = item.is_pinned === 1
    form.elements.status.value = item.status || 'draft'
    updateImagePreview(item.image_url)
  }

  $('#image-file').addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const fd = new FormData(); fd.append('file', file)
    try {
      const r = await fetch('/admin/api/upload', { method: 'POST', body: fd }).then(r => r.json())
      if (r.error) { toast(r.error, 'error'); return }
      $('#image-url-input').value = r.url
      updateImagePreview(r.url)
      toast('업로드 완료', 'success')
    } catch (e) { toast(e.message, 'error') }
  })

  $('#image-url-input').addEventListener('input', (e) => updateImagePreview(e.target.value))

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    const data = {
      title: fd.get('title'),
      category: fd.get('category'),
      body: fd.get('body'),
      image_url: fd.get('image_url') || null,
      external_link: fd.get('external_link') || null,
      start_date: fd.get('start_date') || null,
      end_date: fd.get('end_date') || null,
      show_in_email: fd.get('show_in_email') ? 1 : 0,
      is_pinned: fd.get('is_pinned') ? 1 : 0,
      status: fd.get('status')
    }
    try {
      if (id) {
        await api('/contents/' + id, { method: 'PUT', body: data })
        toast('저장됨', 'success')
      } else {
        const r = await api('/contents', { method: 'POST', body: data })
        toast('등록 완료', 'success')
        location.href = '/admin/contents/' + r.id + '/edit'
      }
    } catch (e) { toast(e.message, 'error') }
  })
}

function updateImagePreview(url) {
  if (url && url.trim()) {
    $('#image-preview').innerHTML = `<img src="${escHtml(url)}" style="max-width:240px;max-height:180px;border-radius:8px;border:1px solid #ecf0f1;">`
  } else {
    $('#image-preview').innerHTML = ''
  }
}

// ===== 구독자 =====
window.loadSubscribers = async function() {
  try {
    const params = new URLSearchParams()
    if ($('#sub-search').value) params.set('search', $('#sub-search').value)
    if ($('#sub-active').value) params.set('active', $('#sub-active').value)
    const r = await api('/subscribers?' + params)
    $('#sub-stats').innerHTML = `
      <div class="stat-card"><div class="label">전체 구독자</div><div class="value">${r.counts.total}</div></div>
      <div class="stat-card"><div class="label">활성 구독자</div><div class="value">${r.counts.active}</div></div>
      <div class="stat-card"><div class="label">해지 구독자</div><div class="value">${r.counts.total - r.counts.active}</div></div>
    `
    $('#subscribers-tbody').innerHTML = r.items.map(s => {
      const label = (s.name && s.name.trim()) ? s.name : s.email
      const safeLabel = (label || '').replace(/'/g, "\\'").replace(/\\/g, '\\\\')
      return `
      <tr>
        <td>${s.id}</td>
        <td>${escHtml(s.email)}</td>
        <td>${escHtml(s.name || '-')}</td>
        <td>${s.active ? '<span class="tag tag-published">활성</span>' : '<span class="tag tag-expired">해지</span>'}</td>
        <td style="font-size:12px;">${(s.created_at || '').slice(0, 10)}</td>
        <td><button class="btn btn-danger btn-sm" onclick="deleteSubscriber(${s.id}, '${safeLabel}')">삭제</button></td>
      </tr>`
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:#95a5a6;padding:30px;">구독자가 없습니다.</td></tr>'
  } catch (e) { toast(e.message, 'error') }
}

// api() 가 throw 하는 메시지에는 details 가 빠지므로, 직접 fetch 하여 구조화된 에러 응답을 활용
async function apiRaw(path, opts = {}) {
  const o = { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } }
  if (o.body && typeof o.body !== 'string') o.body = JSON.stringify(o.body)
  const r = await fetch('/admin/api' + path, o)
  let data = null
  try { data = await r.json() } catch { data = null }
  return { ok: r.ok, status: r.status, data: data || {} }
}

window.deleteSubscriber = async function(id, label) {
  const who = label || `구독자 #${id}`
  if (!confirm(`'${who}' 구독자를 정말 삭제하시겠어요?\n발송 이력은 보존되며, 구독자 정보만 삭제됩니다.`)) return
  try {
    const { ok, status, data } = await apiRaw('/subscribers/' + id, { method: 'DELETE' })
    if (ok && data.success) {
      const name = (data.subscriber && (data.subscriber.name || data.subscriber.email)) || who
      toast(`✅ ${name}님이 삭제되었습니다`, 'success')
      loadSubscribers()
      return
    }
    // 실패 — 구체적 원인 표시
    const code = data.code ? `[${data.code}] ` : ''
    const err = data.error || `HTTP ${status}`
    const detail = data.details ? ` (${data.details.slice(0, 120)})` : ''
    toast(`❌ ${code}${err}${detail}`, 'error')
    console.error('[deleteSubscriber] failed', data)
  } catch (e) {
    toast(`❌ 네트워크 오류: ${e.message}`, 'error')
  }
}

window.addSubscriberPrompt = async function() {
  const email = prompt('이메일 주소를 입력하세요')
  if (!email) return
  const name = prompt('이름 (선택)') || ''
  try {
    await api('/subscribers', { method: 'POST', body: { email, name } })
    toast('추가 완료', 'success')
    loadSubscribers()
  } catch (e) { toast(e.message, 'error') }
}

// ===== 발송 이력 =====
window.loadLogs = async function() {
  try {
    const params = new URLSearchParams()
    if ($('#log-date').value) params.set('date', $('#log-date').value)
    const r = await api('/email-logs?' + params)
    $('#logs-tbody').innerHTML = r.items.map(l => `
      <tr>
        <td style="font-size:12px;" title="UTC: ${escHtml(l.created_at || '')}">${escHtml(formatKST(l.created_at, 'minute'))}</td>
        <td>${escHtml(l.send_date)}</td>
        <td>${escHtml(l.recipient)}</td>
        <td>${escHtml(l.subscriber_name || '-')}</td>
        <td>${l.status === 'success' ? '<span class="tag tag-success">성공</span>' : '<span class="tag tag-failed">실패</span>'}</td>
        <td style="font-size:11px;color:#e74c3c;">${escHtml(l.error_message || '')}</td>
      </tr>
    `).join('') || '<tr><td colspan="6" style="text-align:center;color:#95a5a6;padding:30px;">기록이 없습니다.</td></tr>'
  } catch (e) { toast(e.message, 'error') }
}

// ===== 발송 작업(send_jobs) =====
function _statusTag(s) {
  const map = {
    pending: '<span class="tag" style="background:#ecf0f1;color:#7f8c8d;">대기</span>',
    running: '<span class="tag" style="background:#3498db;color:#fff;">실행중</span>',
    completed: '<span class="tag tag-success">완료</span>',
    failed: '<span class="tag tag-failed">실패</span>',
  }
  return map[s] || `<span class="tag">${escHtml(s)}</span>`
}

window.loadSendJobs = async function() {
  try {
    const r = await api('/send-jobs?limit=30')
    const tbody = $('#send-jobs-tbody')
    if (!tbody) return
    if (!r.jobs || r.jobs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#95a5a6;padding:30px;">발송 작업 기록이 없습니다.</td></tr>'
      return
    }
    tbody.innerHTML = r.jobs.map(j => `
      <tr>
        <td style="font-family:monospace;font-size:12px;">${escHtml(j.job_id)}</td>
        <td>${escHtml(j.scheduled_date)}</td>
        <td><span class="tag">${escHtml(j.trigger_type)}</span></td>
        <td>${_statusTag(j.status)}</td>
        <td style="font-size:13px;">
          <span style="color:#7f8c8d;">${j.total_count}</span> /
          <span style="color:#27ae60;font-weight:700;">${j.success_count}</span> /
          <span style="color:#e74c3c;font-weight:700;">${j.failed_count}</span>
        </td>
        <td style="font-size:11px;color:#7f8c8d;" title="UTC: ${escHtml(j.started_at || '')}">${escHtml(formatKST(j.started_at, 'second'))}</td>
        <td style="font-size:11px;color:#7f8c8d;" title="UTC: ${escHtml(j.completed_at || '')}">${j.completed_at ? escHtml(formatKST(j.completed_at, 'second')) : '-'}</td>
        <td><button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;" onclick="loadSendJobDetail('${escHtml(j.job_id)}')">상세</button></td>
      </tr>
    `).join('')
  } catch (e) {
    const tbody = $('#send-jobs-tbody')
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#e74c3c;padding:14px;">${escHtml(e.message)}</td></tr>`
  }
}

window.loadSendJobDetail = async function(jobId) {
  try {
    const r = await api('/send-jobs/' + encodeURIComponent(jobId))
    const card = $('#send-job-detail-card')
    if (!card) return
    card.style.display = 'block'
    const j = r.job
    const failedCount = (r.failed || []).length
    const meta = `
      <div><strong>Job ID</strong>: <code>${escHtml(j.job_id)}</code></div>
      <div><strong>예정 날짜</strong>: ${escHtml(j.scheduled_date)} | <strong>트리거</strong>: ${escHtml(j.trigger_type)} | <strong>상태</strong>: ${_statusTag(j.status)}</div>
      <div><strong>대상</strong>: ${j.total_count} | <strong>성공</strong>: <span style="color:#27ae60;font-weight:700;">${j.success_count}</span> | <strong>실패</strong>: <span style="color:#e74c3c;font-weight:700;">${j.failed_count}</span> | <strong>예상 소요</strong>: ${j.estimated_seconds || 0}초</div>
      <div><strong>시작</strong>: ${j.started_at ? escHtml(formatKST(j.started_at, 'second')) : '-'} | <strong>완료</strong>: ${j.completed_at ? escHtml(formatKST(j.completed_at, 'second')) : '-'} <span style="color:#95a5a6;font-size:11px;">(원본 UTC: ${escHtml(j.started_at || '-')} → ${escHtml(j.completed_at || '-')})</span></div>
      ${j.error_message ? `<div style="color:#e74c3c;"><strong>오류</strong>: ${escHtml(j.error_message)}</div>` : ''}
      ${failedCount > 0 ? `<div style="color:#e74c3c;"><strong>실패한 구독자</strong>: ${failedCount}명</div>` : ''}
    `
    $('#send-job-detail-meta').innerHTML = meta
    const logs = r.logs || []
    $('#send-job-logs-tbody').innerHTML = logs.map((l, i) => `
      <tr>
        <td style="font-size:11px;color:#7f8c8d;">${i + 1}</td>
        <td>${escHtml(l.recipient)}</td>
        <td>${l.status === 'success' ? '<span class="tag tag-success">성공</span>' : '<span class="tag tag-failed">실패</span>'}</td>
        <td style="text-align:center;">${l.attempts || 1}</td>
        <td style="font-size:12px;">${escHtml(l.error_code || '-')}</td>
        <td style="font-size:11px;color:#e74c3c;max-width:300px;overflow:hidden;text-overflow:ellipsis;">${escHtml(l.error_message || '')}</td>
        <td style="font-size:11px;color:#7f8c8d;" title="UTC: ${escHtml(l.sent_at || '')}">${escHtml(formatKST(l.sent_at, 'second'))}</td>
      </tr>
    `).join('') || '<tr><td colspan="7" style="text-align:center;color:#95a5a6;padding:14px;">로그가 없습니다.</td></tr>'
    card.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (e) { toast(e.message, 'error') }
}

// ===== 환경설정 =====
async function loadSettings() {
  try {
    const r = await api('/settings')
    const s = r.settings
    const form = $('#settings-form')
    const setVal = (n, v) => { if (form.elements[n]) form.elements[n].value = v || '' }
    const setChk = (n, v) => { if (form.elements[n]) form.elements[n].checked = (v === '1' || v === undefined || v === '') }
    setVal('naver_client_id', s.naver_client_id)
    setVal('claude_model', s.claude_model)
    setVal('sender_name', s.sender_name)
    setVal('sender_email', s.sender_email)
    setVal('site_url', s.site_url)
    setVal('send_hour_kst', s.send_hour_kst)
    setVal('company_logo_url', s.company_logo_url)
    // 자동 실행 설정 (기본값 ON / 06:30 / 07:30)
    setChk('auto_collect_enabled', s.auto_collect_enabled)
    setChk('auto_send_enabled', s.auto_send_enabled)
    setVal('auto_collect_time_kst', s.auto_collect_time_kst || '06:30')
    setVal('auto_send_time_kst', s.auto_send_time_kst || '07:30')
    setVal('admin_alert_email', s.admin_alert_email || 'seokjun7127@gmail.com')

    if (s.company_logo_url) {
      $('#logo-preview').innerHTML = `<img src="${escHtml(s.company_logo_url)}" style="max-width:200px;max-height:80px;border:1px solid #ecf0f1;border-radius:6px;background:#2c3e50;padding:6px;">`
    }
    // 마스킹된 비밀번호 필드는 placeholder만
    if (s.naver_client_secret_set === '1') form.elements.naver_client_secret.placeholder = '저장됨 (변경 시에만 입력)'
    if (s.claude_api_key_set === '1') form.elements.claude_api_key.placeholder = '저장됨 (변경 시에만 입력)'
    if (s.resend_api_key_set === '1') form.elements.resend_api_key.placeholder = '저장됨 (변경 시에만 입력)'

    // 자동 실행 정보 영역 채우기
    loadAutoJobInfo()
    // 시각 검증 이벤트
    const ct = form.elements.auto_collect_time_kst
    const st = form.elements.auto_send_time_kst
    const validate = () => {
      const cv = ct?.value, sv = st?.value
      const w = $('#auto-time-warning')
      if (!cv || !sv || !w) return
      const [ch, cm] = cv.split(':').map(x => parseInt(x))
      const [sh, sm] = sv.split(':').map(x => parseInt(x))
      const diff = (sh * 60 + sm) - (ch * 60 + cm)
      if (diff < 30) {
        w.textContent = `⚠️ 발송 시각은 수집·요약 시각보다 최소 30분 이후여야 합니다. (현재 차이: ${diff}분)`
        w.style.display = ''
      } else {
        w.style.display = 'none'
      }
    }
    ct?.addEventListener('change', validate)
    st?.addEventListener('change', validate)
    validate()
  } catch (e) { toast(e.message, 'error') }

  $('#logo-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const fd = new FormData(); fd.append('file', file)
    try {
      const r = await fetch('/admin/api/upload', { method: 'POST', body: fd }).then(r => r.json())
      if (r.error) { toast(r.error, 'error'); return }
      $('#logo-url-input').value = r.url
      $('#logo-preview').innerHTML = `<img src="${escHtml(r.url)}" style="max-width:200px;max-height:80px;border:1px solid #ecf0f1;border-radius:6px;background:#2c3e50;padding:6px;">`
      toast('업로드 완료', 'success')
    } catch (e) { toast(e.message, 'error') }
  })

  $('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = e.target
    const fd = new FormData(form)
    const data = {}
    for (const [k, v] of fd.entries()) {
      if (typeof v === 'string' && v) data[k] = v
    }
    // 체크박스: 비체크 상태도 명시적으로 '0'으로 전송
    const toggleNames = ['auto_collect_enabled', 'auto_send_enabled']
    for (const n of toggleNames) {
      const el = form.elements[n]
      if (el) data[n] = el.checked ? '1' : '0'
    }
    // 시각 검증 (클라이언트 사전 차단)
    const ct = data.auto_collect_time_kst, sv = data.auto_send_time_kst
    if (ct && sv) {
      const [ch, cm] = ct.split(':').map(x => parseInt(x))
      const [sh, sm] = sv.split(':').map(x => parseInt(x))
      if ((sh * 60 + sm) - (ch * 60 + cm) < 30) {
        toast('발송 시각은 수집·요약 시각보다 최소 30분 이후여야 합니다.', 'error')
        return
      }
    }
    try {
      await api('/settings', { method: 'PUT', body: data })
      const newPw = $('#new-password').value
      if (newPw) {
        await api('/change-password', { method: 'POST', body: { password: newPw } })
        $('#new-password').value = ''
      }
      toast('저장됨', 'success')
      loadSettings()
    } catch (e) { toast(e.message, 'error') }
  })
}

// 수집 카테고리 그룹 활성화 로드/저장
async function loadCollectGroups() {
  if (!$('#collect-groups-wrap')) return
  try {
    const r = await api('/collect-groups')
    const enabled = r.enabled || {}
    $$('.cg-toggle').forEach(cb => {
      const g = cb.dataset.group
      cb.checked = enabled[g] !== false  // 기본 true
    })
  } catch (e) {
    console.error('[collect-groups] load failed', e)
  }
}

window.saveCollectGroups = async function() {
  const data = {}
  $$('.cg-toggle').forEach(cb => {
    data[cb.dataset.group] = cb.checked
  })
  const msg = $('#collect-groups-msg')
  try {
    await api('/collect-groups', { method: 'PUT', body: { enabled: data } })
    if (msg) {
      msg.textContent = '✅ 저장됨'
      msg.style.color = '#27ae60'
      setTimeout(() => { msg.textContent = '' }, 3000)
    }
    toast('카테고리 활성화 저장 완료', 'success')
  } catch (e) {
    if (msg) {
      msg.textContent = '❌ ' + (e.message || '실패')
      msg.style.color = '#e74c3c'
    }
    toast(e.message || '저장 실패', 'error')
  }
}

// 자동 실행 정보 (다음 예정 / 마지막 결과) 로드
async function loadAutoJobInfo() {
  if (!$('#auto-job-info')) return
  try {
    const r = await api('/auto-job/status')
    const next = r.nextRun || {}
    const last = r.lastResult || {}
    $('#next-collect-time').innerHTML = `수집: <strong>${escHtml(next.collect || '-')}</strong>`
    $('#next-send-time').innerHTML = `발송: <strong>${escHtml(next.send || '-')}</strong>`

    const fmtLast = (l, isCollect) => {
      if (!l) return '기록 없음'
      const stIcon = { success: '✅', partial: '⚠️', failed: '❌', skipped: '⏭️' }[l.status] || '•'
      const detail = isCollect
        ? `${l.news_collected || 0}건 수집`
        : `${l.emails_sent || 0}/${(l.emails_sent || 0) + (l.emails_failed || 0)} 발송`
      const err = l.error_message ? ` <span style="color:#e74c3c;">· ${escHtml(l.error_message.slice(0, 80))}</span>` : ''
      return `${stIcon} ${escHtml(formatKST(l.started_at, 'second'))} — ${escHtml(l.status)}, ${escHtml(detail)}${err}`
    }
    $('#last-collect-result').innerHTML = `수집·요약: ${fmtLast(last.collect, true)}`
    $('#last-send-result').innerHTML = `발송: ${fmtLast(last.send, false)}`
  } catch (e) {
    $('#next-collect-time').textContent = '수집: 조회 실패'
    $('#next-send-time').textContent = '발송: 조회 실패'
  }
}

// ===== 페이지별 초기화 =====
document.addEventListener('DOMContentLoaded', () => {
  if ($('#dashboard-stats')) loadDashboard()
  if ($('#contents-tbody')) loadContents()
  if ($('#content-form')) initContentForm()
  if ($('#subscribers-tbody')) loadSubscribers()
  if ($('#logs-tbody')) loadLogs()
  if ($('#send-jobs-tbody')) loadSendJobs()
  if ($('#settings-form')) {
    loadSettings()
    loadCollectGroups()
  }
})
