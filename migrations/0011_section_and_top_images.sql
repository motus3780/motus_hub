-- ════════════════════════════════════════════════════════════════════
-- 0011_section_and_top_images.sql
--
-- 위클리 뉴스레터의 대표 이미지를 관리자가 수동 업로드/교체할 수 있도록
-- 두 종류의 이미지 슬롯 테이블을 추가:
--
--   1) section_images
--      섹션(카테고리) 단위의 "고정" 대표 이미지.
--      매 호마다 자동으로 사용되며, 관리자 페이지에서 한 번 등록하면
--      모든 호에 동일하게 적용됨. (브랜드 자산 성격)
--      section_key: urban/sale/builder/policy/media/company 등
--
--   2) weekly_top_images
--      매 호(week_start_date)의 TOP 이슈에 부착되는 임시 이미지.
--      한 호에 1~2장까지 등록 가능 (slot=1, slot=2).
--      해당 호에만 표시되고, 다음 호엔 자동으로 새 슬롯이 비워짐.
-- ════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────
-- 1) 섹션 대표 이미지 (카테고리별 고정)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS section_images (
  section_key   TEXT PRIMARY KEY,    -- 'urban'|'sale'|'builder'|'policy'|'media'|'company'
  image_url     TEXT NOT NULL,       -- '/r2/uploads/...' 또는 외부 URL
  image_key     TEXT,                -- R2 key (삭제 시 사용)
  alt_text      TEXT,                -- 대체 텍스트
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by    INTEGER              -- admin_users.id
);

-- ──────────────────────────────────────────────
-- 2) 호별 TOP 이미지 (1주 한정, slot 1~2)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_top_images (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start_date   TEXT NOT NULL,   -- YYYY-MM-DD
  slot              INTEGER NOT NULL CHECK (slot IN (1, 2)),
  image_url         TEXT NOT NULL,
  image_key         TEXT,            -- R2 key
  caption           TEXT,            -- 이미지 캡션 (선택)
  link_url          TEXT,            -- 클릭 시 이동할 URL (선택)
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by        INTEGER,
  UNIQUE (week_start_date, slot)
);

CREATE INDEX IF NOT EXISTS idx_weekly_top_images_week
  ON weekly_top_images (week_start_date);
