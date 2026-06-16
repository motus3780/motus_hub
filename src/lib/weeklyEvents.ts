// 위클리 이벤트 캘린더 (관리자 직접 입력 — Q3=A)
//
// weekly_events 테이블 CRUD를 캡슐화.
// - week_start_date: 어느 호(주)에 노출할지 (KST 월요일)
// - section: 'this_week' (이번 주 호의 "이번 주 일정") | 'next_week' (이번 주 호의 "다음 주 일정")
// - event_type: 8종 (WEEKLY_EVENT_TYPE_LABELS)

import type {
  WeeklyEvent, WeeklyEventSection, WeeklyEventType,
} from './types'

export interface WeeklyEventInput {
  week_start_date: string
  section: WeeklyEventSection
  event_type: WeeklyEventType
  event_date?: string | null
  title: string
  description?: string | null
  category?: string | null
  sort_order?: number
}

const VALID_SECTIONS: WeeklyEventSection[] = ['this_week', 'next_week']
const VALID_TYPES: WeeklyEventType[] = [
  'subscription', 'modelhouse', 'bid', 'policy', 'rate', 'supply', 'announcement', 'other',
]

export function validateWeeklyEventInput(input: WeeklyEventInput): { ok: true } | { ok: false; error: string } {
  if (!input.week_start_date || !/^\d{4}-\d{2}-\d{2}$/.test(input.week_start_date)) {
    return { ok: false, error: 'week_start_date 는 YYYY-MM-DD 형식이어야 합니다.' }
  }
  if (!VALID_SECTIONS.includes(input.section)) {
    return { ok: false, error: `section 은 ${VALID_SECTIONS.join(' | ')} 중 하나여야 합니다.` }
  }
  if (!VALID_TYPES.includes(input.event_type)) {
    return { ok: false, error: `event_type 은 ${VALID_TYPES.join(' | ')} 중 하나여야 합니다.` }
  }
  if (!input.title || !input.title.trim()) {
    return { ok: false, error: '제목(title)을 입력하세요.' }
  }
  if (input.event_date && !/^\d{4}-\d{2}-\d{2}$/.test(input.event_date)) {
    return { ok: false, error: 'event_date 는 YYYY-MM-DD 형식이어야 합니다.' }
  }
  return { ok: true }
}

export async function listWeeklyEvents(
  db: D1Database,
  weekStart: string,
  section?: WeeklyEventSection
): Promise<WeeklyEvent[]> {
  if (section) {
    const r = await db.prepare(`
      SELECT * FROM weekly_events
      WHERE week_start_date = ? AND section = ?
      ORDER BY sort_order ASC, event_date ASC NULLS LAST, id ASC
    `).bind(weekStart, section).all<WeeklyEvent>()
    return r.results
  }
  const r = await db.prepare(`
    SELECT * FROM weekly_events
    WHERE week_start_date = ?
    ORDER BY section ASC, sort_order ASC, event_date ASC NULLS LAST, id ASC
  `).bind(weekStart).all<WeeklyEvent>()
  return r.results
}

export async function getWeeklyEvent(db: D1Database, id: number): Promise<WeeklyEvent | null> {
  const r = await db.prepare('SELECT * FROM weekly_events WHERE id = ?').bind(id).first<WeeklyEvent>()
  return r ?? null
}

export async function createWeeklyEvent(db: D1Database, input: WeeklyEventInput): Promise<number> {
  const v = validateWeeklyEventInput(input)
  if (!v.ok) throw new Error(v.error)
  const r = await db.prepare(`
    INSERT INTO weekly_events (
      week_start_date, section, event_type, event_date, title, description, category, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.week_start_date,
    input.section,
    input.event_type,
    input.event_date || null,
    input.title.trim(),
    input.description?.trim() || null,
    input.category?.trim() || null,
    input.sort_order ?? 0,
  ).run()
  return r.meta.last_row_id as number
}

export async function updateWeeklyEvent(
  db: D1Database,
  id: number,
  input: Partial<WeeklyEventInput>
): Promise<void> {
  // 부분 업데이트: 제공된 필드만 SET. 전체 검증은 컨트롤러에서 fetch + merge 후 호출 권장.
  const fields: string[] = []
  const values: any[] = []

  if (input.week_start_date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.week_start_date)) {
      throw new Error('week_start_date 형식 오류')
    }
    fields.push('week_start_date = ?'); values.push(input.week_start_date)
  }
  if (input.section !== undefined) {
    if (!VALID_SECTIONS.includes(input.section)) throw new Error('section 값 오류')
    fields.push('section = ?'); values.push(input.section)
  }
  if (input.event_type !== undefined) {
    if (!VALID_TYPES.includes(input.event_type)) throw new Error('event_type 값 오류')
    fields.push('event_type = ?'); values.push(input.event_type)
  }
  if (input.event_date !== undefined) {
    if (input.event_date && !/^\d{4}-\d{2}-\d{2}$/.test(input.event_date)) {
      throw new Error('event_date 형식 오류')
    }
    fields.push('event_date = ?'); values.push(input.event_date || null)
  }
  if (input.title !== undefined) {
    if (!input.title || !input.title.trim()) throw new Error('title 비어 있음')
    fields.push('title = ?'); values.push(input.title.trim())
  }
  if (input.description !== undefined) {
    fields.push('description = ?'); values.push(input.description?.trim() || null)
  }
  if (input.category !== undefined) {
    fields.push('category = ?'); values.push(input.category?.trim() || null)
  }
  if (input.sort_order !== undefined) {
    fields.push('sort_order = ?'); values.push(input.sort_order)
  }

  if (fields.length === 0) return  // 변경할 필드 없음

  fields.push('updated_at = CURRENT_TIMESTAMP')
  values.push(id)
  await db.prepare(`UPDATE weekly_events SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
}

export async function deleteWeeklyEvent(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM weekly_events WHERE id = ?').bind(id).run()
}

/** 주별 이벤트 통계 (관리자 페이지 상단 카운트) */
export async function countWeeklyEventsByWeek(db: D1Database, weekStart: string): Promise<{ this_week: number; next_week: number; total: number }> {
  const rows = await db.prepare(`
    SELECT section, COUNT(*) AS c FROM weekly_events
    WHERE week_start_date = ? GROUP BY section
  `).bind(weekStart).all<{ section: string; c: number }>()
  let tw = 0, nw = 0
  for (const r of rows.results) {
    if (r.section === 'this_week') tw = r.c
    else if (r.section === 'next_week') nw = r.c
  }
  return { this_week: tw, next_week: nw, total: tw + nw }
}
