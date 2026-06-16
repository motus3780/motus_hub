// ════════════════════════════════════════════════════════════════════
// 위클리 이미지 라이브러리
// — section_images: 카테고리별 고정 대표 이미지 (모든 호 공통)
// — weekly_top_images: 호별 TOP 슬롯 1~2장 (해당 주만)
// ════════════════════════════════════════════════════════════════════

// 운영자가 관리할 수 있는 섹션 키
// (renderWeeklyEmail의 SectionKey 중 시각 효과가 의미 있는 6종만 노출)
export const MANAGEABLE_SECTION_KEYS = [
  'urban',     // 🏗️ 도시정비 (MAIN)
  'sale',      // 🏢 분양·청약
  'builder',   // 🔨 건설사
  'policy',    // 📊 정책·시장
  'media',     // 📢 광고/매체
  'company',   // 🔵 회사 위클리 (GS 등)
] as const

export type ManageableSectionKey = typeof MANAGEABLE_SECTION_KEYS[number]

export const SECTION_KEY_META: Record<ManageableSectionKey, { label: string; icon: string; description: string }> = {
  urban:   { label: '도시정비 동향',  icon: '🏗️', description: '재개발·재건축·신통기획·모아타운 등 메인 섹션 / 📍 메일에서 섹션 제목 아래 노출' },
  sale:    { label: '분양·청약',      icon: '🏢', description: '청약·분양·미분양 헤드라인 섹션 / 📍 메일에서 섹션 제목 아래 노출' },
  builder: { label: '건설사 동향',    icon: '🔨', description: '건설사 수주·실적·인사·사고 섹션 / 📍 메일에서 섹션 제목 아래 노출' },
  policy:  { label: '정책·시장',      icon: '📊', description: '정책·금리·규제·시장 지표 섹션 / 📍 메일에서 섹션 제목 아래 노출' },
  media:   { label: '광고/매체',      icon: '📢', description: 'OOH·디지털·CTV·매체사 동향 섹션 / 📍 메일에서 섹션 제목 아래 노출' },
  company: { label: '회사 위클리',    icon: '🔵', description: 'GS건설 등 회사 맞춤형 위클리 섹션 / 📍 메일에서 섹션 제목 아래 노출' },
}

export interface SectionImageRow {
  section_key: string
  image_url: string
  image_key: string | null
  alt_text: string | null
  updated_at: string
  updated_by: number | null
}

export interface WeeklyTopImageRow {
  id: number
  week_start_date: string
  slot: number
  image_url: string
  image_key: string | null
  caption: string | null
  link_url: string | null
  created_at: string
  created_by: number | null
}

/** 카테고리 대표 이미지 — 전체 조회 (관리자 화면) */
export async function listSectionImages(db: D1Database): Promise<SectionImageRow[]> {
  const r = await db.prepare(
    'SELECT section_key, image_url, image_key, alt_text, updated_at, updated_by FROM section_images'
  ).all<SectionImageRow>()
  return r.results || []
}

/** 카테고리 대표 이미지 — 키→URL Map (메일 렌더링 시 사용) */
export async function getSectionImageMap(db: D1Database): Promise<Record<string, string>> {
  const rows = await listSectionImages(db)
  const out: Record<string, string> = {}
  for (const r of rows) {
    if (r.section_key && r.image_url) out[r.section_key] = r.image_url
  }
  return out
}

/** 카테고리 대표 이미지 — UPSERT */
export async function upsertSectionImage(params: {
  db: D1Database
  sectionKey: string
  imageUrl: string
  imageKey?: string | null
  altText?: string | null
  updatedBy?: number | null
}): Promise<void> {
  const { db, sectionKey, imageUrl, imageKey, altText, updatedBy } = params
  await db.prepare(`
    INSERT INTO section_images (section_key, image_url, image_key, alt_text, updated_at, updated_by)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(section_key) DO UPDATE SET
      image_url = excluded.image_url,
      image_key = excluded.image_key,
      alt_text = excluded.alt_text,
      updated_at = CURRENT_TIMESTAMP,
      updated_by = excluded.updated_by
  `).bind(sectionKey, imageUrl, imageKey ?? null, altText ?? null, updatedBy ?? null).run()
}

/** 카테고리 대표 이미지 — 삭제 (R2 삭제는 호출자가 책임) */
export async function deleteSectionImage(db: D1Database, sectionKey: string): Promise<string | null> {
  const row = await db.prepare('SELECT image_key FROM section_images WHERE section_key = ?')
    .bind(sectionKey).first<{ image_key: string | null }>()
  if (!row) return null
  await db.prepare('DELETE FROM section_images WHERE section_key = ?').bind(sectionKey).run()
  return row.image_key
}

/** 호별 TOP 이미지 — 특정 주차 전체 조회 (slot ASC) */
export async function listWeeklyTopImages(
  db: D1Database, weekStartDate: string
): Promise<WeeklyTopImageRow[]> {
  const r = await db.prepare(
    'SELECT * FROM weekly_top_images WHERE week_start_date = ? ORDER BY slot ASC'
  ).bind(weekStartDate).all<WeeklyTopImageRow>()
  return r.results || []
}

/** 호별 TOP 이미지 — UPSERT (slot 1 or 2) */
export async function upsertWeeklyTopImage(params: {
  db: D1Database
  weekStartDate: string
  slot: 1 | 2
  imageUrl: string
  imageKey?: string | null
  caption?: string | null
  linkUrl?: string | null
  createdBy?: number | null
}): Promise<void> {
  const { db, weekStartDate, slot, imageUrl, imageKey, caption, linkUrl, createdBy } = params
  // UNIQUE (week_start_date, slot) 활용
  await db.prepare(`
    INSERT INTO weekly_top_images (week_start_date, slot, image_url, image_key, caption, link_url, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(week_start_date, slot) DO UPDATE SET
      image_url = excluded.image_url,
      image_key = excluded.image_key,
      caption = excluded.caption,
      link_url = excluded.link_url,
      created_at = CURRENT_TIMESTAMP,
      created_by = excluded.created_by
  `).bind(weekStartDate, slot, imageUrl, imageKey ?? null, caption ?? null, linkUrl ?? null, createdBy ?? null).run()
}

/** 호별 TOP 이미지 — 삭제 (R2 삭제는 호출자가 책임) */
export async function deleteWeeklyTopImage(
  db: D1Database, weekStartDate: string, slot: 1 | 2
): Promise<string | null> {
  const row = await db.prepare(
    'SELECT image_key FROM weekly_top_images WHERE week_start_date = ? AND slot = ?'
  ).bind(weekStartDate, slot).first<{ image_key: string | null }>()
  if (!row) return null
  await db.prepare(
    'DELETE FROM weekly_top_images WHERE week_start_date = ? AND slot = ?'
  ).bind(weekStartDate, slot).run()
  return row.image_key
}

/** R2에서 이미지 삭제 (best effort, 실패해도 throw 안 함) */
export async function tryDeleteR2Object(R2: R2Bucket | undefined, key: string | null): Promise<void> {
  if (!R2 || !key) return
  try {
    await R2.delete(key)
  } catch (e) {
    console.warn('[weeklyImages] R2 삭제 실패 (무시):', key, e)
  }
}
