// ============================================================
// 위클리 캘린더 (weekly_events) 관리자 UI
// ------------------------------------------------------------
// 의존: 페이지 내 #we-week-input, #we-list-this-week,
//       #we-list-next-week, #we-modal, #we-form 등
// API:  GET/POST/PUT/DELETE /admin/api/weekly-events
// ============================================================

(function () {
  'use strict'

  const API = '/admin/api/weekly-events'

  // 이벤트 타입 라벨 (서버 측 WEEKLY_EVENT_TYPE_LABELS 와 동일하게 유지)
  const TYPE_LABELS = {
    subscription: { label: '청약', icon: '📝' },
    modelhouse:   { label: '견본주택', icon: '🏠' },
    bid:          { label: '입찰', icon: '📋' },
    policy:       { label: '정책', icon: '📜' },
    rate:         { label: '금리', icon: '📊' },
    supply:       { label: '공급', icon: '🏗️' },
    announcement: { label: '발표', icon: '📢' },
    other:        { label: '기타', icon: '📌' },
  }

  const SECTION_LABELS = {
    this_week: '이번 주 일정',
    next_week: '다음 주 일정',
  }

  // --- 유틸 ---------------------------------------------------
  function escapeHtml(s) {
    if (s == null) return ''
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function todayYMD() {
    const d = new Date()
    // 로컬 기준 YYYY-MM-DD
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  function showError(msg) {
    const el = document.getElementById('we-form-error')
    if (!el) return
    el.textContent = msg || ''
    el.style.display = msg ? 'block' : 'none'
  }

  async function api(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    }
    if (body !== undefined) opts.body = JSON.stringify(body)
    const res = await fetch(API + path, opts)
    let data = null
    try { data = await res.json() } catch (_) { /* noop */ }
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`
      throw new Error(msg)
    }
    return data
  }

  // --- 렌더 ---------------------------------------------------
  function renderRow(ev) {
    const t = TYPE_LABELS[ev.event_type] || { label: ev.event_type, icon: '📌' }
    const date = ev.event_date ? `<span class="we-row-date">📅 ${escapeHtml(ev.event_date)}</span>` : ''
    const cat = ev.category ? `<span class="we-row-cat">#${escapeHtml(ev.category)}</span>` : ''
    const desc = ev.description ? `<div class="we-row-desc">${escapeHtml(ev.description)}</div>` : ''
    return `
      <div class="we-row-card" data-id="${ev.id}">
        <div class="we-row-main">
          <div class="we-row-head">
            <span class="we-row-type">${t.icon} ${escapeHtml(t.label)}</span>
            ${date}
            ${cat}
            <span class="we-row-sort">순서 ${ev.sort_order ?? 0}</span>
          </div>
          <div class="we-row-title">${escapeHtml(ev.title)}</div>
          ${desc}
        </div>
        <div class="we-row-actions">
          <button class="btn btn-sm btn-secondary" onclick="weeklyEvents.openEdit(${ev.id})">수정</button>
          <button class="btn btn-sm btn-danger" onclick="weeklyEvents.deleteEvent(${ev.id})">삭제</button>
        </div>
      </div>
    `
  }

  function renderList(events) {
    const thisWeek = events.filter((e) => e.section === 'this_week')
    const nextWeek = events.filter((e) => e.section === 'next_week')
    const t = document.getElementById('we-list-this-week')
    const n = document.getElementById('we-list-next-week')
    if (t) {
      t.innerHTML = thisWeek.length
        ? thisWeek.map(renderRow).join('')
        : '<div class="we-empty">등록된 일정이 없습니다. “+ 새 일정 추가” 버튼으로 입력하세요.</div>'
    }
    if (n) {
      n.innerHTML = nextWeek.length
        ? nextWeek.map(renderRow).join('')
        : '<div class="we-empty">등록된 일정이 없습니다.</div>'
    }
  }

  function renderMeta(data) {
    const el = document.getElementById('we-meta')
    if (!el) return
    const c = data.counts || {}
    el.innerHTML = `
      대상 호 (월요일): <strong>${escapeHtml(data.week_start_date)}</strong>
      &nbsp;|&nbsp; 이번 주 일정 <strong>${c.this_week ?? 0}</strong>건
      &nbsp;|&nbsp; 다음 주 일정 <strong>${c.next_week ?? 0}</strong>건
      &nbsp;|&nbsp; 총 <strong>${c.total ?? 0}</strong>건
    `
  }

  // --- 액션 ---------------------------------------------------
  async function loadList() {
    const input = document.getElementById('we-week-input')
    const week = input && input.value ? input.value : ''
    const qs = week ? `?week=${encodeURIComponent(week)}` : ''
    try {
      const data = await api('GET', qs)
      // input에 실제 사용된 weekStart 반영
      if (input && (!input.value || input.value !== data.week_start_date)) {
        input.value = data.week_start_date
      }
      renderMeta(data)
      renderList(data.events || [])
    } catch (e) {
      const meta = document.getElementById('we-meta')
      if (meta) meta.innerHTML = `<span style="color:#c0392b;">조회 실패: ${escapeHtml(e.message)}</span>`
    }
  }

  function openModal(title) {
    const m = document.getElementById('we-modal')
    const t = document.getElementById('we-modal-title')
    if (t) t.textContent = title || '일정 편집'
    if (m) m.style.display = 'flex'
    showError('')
  }

  function closeModal() {
    const m = document.getElementById('we-modal')
    if (m) m.style.display = 'none'
  }

  function fillForm(ev) {
    document.getElementById('we-id').value = ev?.id ?? ''
    document.getElementById('we-week-start').value =
      ev?.week_start_date || document.getElementById('we-week-input')?.value || ''
    document.getElementById('we-section').value = ev?.section || 'this_week'
    document.getElementById('we-event-type').value = ev?.event_type || 'subscription'
    document.getElementById('we-event-date').value = ev?.event_date || ''
    document.getElementById('we-category').value = ev?.category || ''
    document.getElementById('we-title').value = ev?.title || ''
    document.getElementById('we-description').value = ev?.description || ''
    document.getElementById('we-sort-order').value = ev?.sort_order ?? 0
  }

  function openCreate() {
    fillForm(null)
    openModal('새 일정 추가')
  }

  async function openEdit(id) {
    try {
      const data = await api('GET', '/' + id)
      fillForm(data.event)
      openModal('일정 수정 (#' + id + ')')
    } catch (e) {
      alert('이벤트 조회 실패: ' + e.message)
    }
  }

  async function submitForm(e) {
    if (e && e.preventDefault) e.preventDefault()
    showError('')
    const id = document.getElementById('we-id').value
    const payload = {
      week_start_date: document.getElementById('we-week-start').value || undefined,
      section: document.getElementById('we-section').value,
      event_type: document.getElementById('we-event-type').value,
      event_date: document.getElementById('we-event-date').value || null,
      category: document.getElementById('we-category').value || null,
      title: document.getElementById('we-title').value.trim(),
      description: document.getElementById('we-description').value || null,
      sort_order: parseInt(document.getElementById('we-sort-order').value || '0', 10) || 0,
    }
    if (!payload.title) {
      showError('제목은 필수입니다.')
      return
    }
    try {
      if (id) {
        await api('PUT', '/' + id, payload)
      } else {
        await api('POST', '', payload)
      }
      closeModal()
      await loadList()
    } catch (err) {
      showError('저장 실패: ' + err.message)
    }
  }

  async function deleteEvent(id) {
    if (!confirm('이 일정을 삭제할까요? (#' + id + ')')) return
    try {
      await api('DELETE', '/' + id)
      await loadList()
    } catch (e) {
      alert('삭제 실패: ' + e.message)
    }
  }

  // --- init ---------------------------------------------------
  function init() {
    const input = document.getElementById('we-week-input')
    if (input && !input.value) input.value = todayYMD()
    // 모달 바깥 클릭으로 닫기
    const modal = document.getElementById('we-modal')
    if (modal) {
      modal.addEventListener('click', (ev) => {
        if (ev.target === modal) closeModal()
      })
    }
    loadList()
  }

  // 노출
  window.weeklyEvents = {
    loadList,
    openCreate,
    openEdit,
    closeModal,
    submitForm,
    deleteEvent,
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
