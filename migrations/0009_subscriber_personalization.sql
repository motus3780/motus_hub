-- 0009_subscriber_personalization.sql
-- 수신자별 맞춤 위클리/데일리 발송을 위한 데이터 모델 확장
--
-- (1) subscribers 테이블에 회사 프로필 컬럼 추가
--     - company           : 표시용 회사명 (예: "GS건설")
--     - company_profile   : companyProfiles.ts의 프로필 키 (예: "gs", "hdc")
--     - focus_keywords    : JSON 배열, 수신자별 오버라이드 가능
--     - competitor_keywords : JSON 배열
--     - watch_regions     : JSON 배열, 관심 정비구역
--
-- (2) weekly_personalized_summaries 테이블 신설
--     - 한 주(week_start_date) × 회사 프로필별 별도 본문 저장
--     - 기존 weekly_summaries(일반본)는 그대로 유지 (회사 미지정 수신자용)

-- ─────────────────────────────────────────────────────────────
-- (1) subscribers 테이블 확장
-- ─────────────────────────────────────────────────────────────
ALTER TABLE subscribers ADD COLUMN company TEXT;
ALTER TABLE subscribers ADD COLUMN company_profile TEXT;
ALTER TABLE subscribers ADD COLUMN focus_keywords TEXT;       -- JSON array
ALTER TABLE subscribers ADD COLUMN competitor_keywords TEXT;  -- JSON array
ALTER TABLE subscribers ADD COLUMN watch_regions TEXT;        -- JSON array

CREATE INDEX IF NOT EXISTS idx_subscribers_company_profile ON subscribers(company_profile);

-- ─────────────────────────────────────────────────────────────
-- (2) weekly_personalized_summaries — 회사별 위클리 본문
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_personalized_summaries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start_date TEXT NOT NULL,                      -- YYYY-MM-DD KST 월요일
  week_end_date   TEXT NOT NULL,
  company_profile TEXT NOT NULL,                       -- 'gs','hdc','samsung',...
  vol_no          INTEGER NOT NULL,                    -- 일반본과 동일한 VOL 번호 사용
  issue_date      TEXT NOT NULL,
  market_oneliner TEXT,
  content         TEXT NOT NULL,
  article_count   INTEGER DEFAULT 0,
  -- 검증 결과 저장: JSON {passed: bool, warnings: [..], stats: {...}}
  verification    TEXT,
  status          TEXT NOT NULL DEFAULT 'draft',       -- draft | ready | held | sent
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_weekly_personalized_week_company
  ON weekly_personalized_summaries(week_start_date, company_profile);
CREATE INDEX IF NOT EXISTS idx_weekly_personalized_company
  ON weekly_personalized_summaries(company_profile);
CREATE INDEX IF NOT EXISTS idx_weekly_personalized_status
  ON weekly_personalized_summaries(status);
