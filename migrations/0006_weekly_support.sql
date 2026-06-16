-- 모투스 위클리 전환: 주간 발행 지원 스키마
-- 결정 사항:
--   ❶ 주 시작일(월요일 KST) 기반 키 (week_start_date: YYYY-MM-DD)
--   ❷ 기존 summaries는 일간 유지, weekly_summaries 신설
--   Q1 VOL 번호: 자동 카운트 (일간 발행 누적 이어받기)
--   Q2 주간 범위: 직전 주 월~일 (전체 7일)
--   Q3 캘린더: 관리자 직접 입력 (weekly_events)

-- ────────────────────────────────────────────────────────────────────
-- 주간 요약 (이번 주 호)
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start_date TEXT UNIQUE NOT NULL,   -- YYYY-MM-DD (KST 월요일, 직전주 시작일)
  week_end_date   TEXT NOT NULL,          -- YYYY-MM-DD (KST 일요일, 직전주 종료일)
  vol_no          INTEGER NOT NULL,       -- VOL.번호 (일간 누적 카운트 이어받음)
  issue_date      TEXT NOT NULL,          -- YYYY-MM-DD (발행일 = 발송 월요일, KST)
  market_oneliner TEXT,                   -- "이번 주 시장 한 줄 요약"
  content         TEXT NOT NULL,          -- Claude 생성 본문 (HTML/Markdown)
  article_count   INTEGER DEFAULT 0,      -- 주간 집계 기사 수
  status          TEXT NOT NULL DEFAULT 'draft',  -- draft | ready | sent
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_weekly_summaries_week  ON weekly_summaries(week_start_date);
CREATE INDEX IF NOT EXISTS idx_weekly_summaries_vol   ON weekly_summaries(vol_no);
CREATE INDEX IF NOT EXISTS idx_weekly_summaries_issue ON weekly_summaries(issue_date);

-- ────────────────────────────────────────────────────────────────────
-- 주간 TOP 3 핵심 이슈 (헤더 카드 강조용)
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_top_news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start_date TEXT NOT NULL,          -- weekly_summaries.week_start_date 참조
  rank            INTEGER NOT NULL,       -- 1, 2, 3
  news_id         INTEGER,                -- news.id (FK, 원본 보존)
  title           TEXT NOT NULL,          -- snapshot (원본 삭제 대비)
  summary         TEXT,                   -- 한 줄 요약 (AI 생성)
  link            TEXT,
  source          TEXT,
  category        TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (news_id) REFERENCES news(id) ON DELETE SET NULL,
  UNIQUE (week_start_date, rank)
);
CREATE INDEX IF NOT EXISTS idx_weekly_top_news_week ON weekly_top_news(week_start_date);

-- ────────────────────────────────────────────────────────────────────
-- 주간 이벤트 캘린더 (관리자 직접 입력)
--   사용처:
--   - "이번 주 분양·입찰 캘린더" 섹션
--   - "다음 주 체크 포인트" 섹션
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start_date TEXT NOT NULL,          -- 어느 호에 노출할지 (월요일 KST)
  section         TEXT NOT NULL,          -- 'this_week' | 'next_week'
  event_type      TEXT NOT NULL,          -- 'subscription' | 'modelhouse' | 'bid' | 'policy' | 'rate' | 'supply' | 'announcement' | 'other'
  event_date      TEXT,                   -- YYYY-MM-DD (실제 이벤트 일자, optional)
  title           TEXT NOT NULL,          -- 이벤트 제목
  description     TEXT,                   -- 상세 설명 (optional)
  category        TEXT,                   -- 카테고리 태그 (분양/청약/정책/금리 등)
  sort_order      INTEGER DEFAULT 0,      -- 같은 섹션 내 정렬 (낮을수록 위)
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_weekly_events_week    ON weekly_events(week_start_date);
CREATE INDEX IF NOT EXISTS idx_weekly_events_section ON weekly_events(week_start_date, section, sort_order);

-- ────────────────────────────────────────────────────────────────────
-- 주간 아카이브 태그 (지난 호 카드 표시용)
--   추천 태그 풀: PF / 청약 / 정책 / 브랜드 / 금리 / 입찰 / 공급
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_summary_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start_date TEXT NOT NULL,
  tag             TEXT NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (week_start_date, tag)
);
CREATE INDEX IF NOT EXISTS idx_weekly_summary_tags_week ON weekly_summary_tags(week_start_date);

-- ────────────────────────────────────────────────────────────────────
-- 초기 설정값: VOL 카운터 시작점 (일간 발행 횟수 자동 이어받기)
--   Q1=C: 마이그레이션 시점에 summaries 테이블의 row 수를 VOL 시작값으로 사용
--   이후 weekly_summaries 발행 시마다 +1
-- ────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO settings (key, value)
SELECT 'weekly_vol_counter', CAST(COUNT(*) AS TEXT) FROM summaries;

-- 주간 발행 모드 토글 (안전 가드 — 활성화 전까지 자동 발송 안 함)
INSERT OR IGNORE INTO settings (key, value) VALUES ('weekly_mode_enabled', 'false');

-- 위클리 발송 시각 (KST 월요일 07:00, 크론과 함께 자동화에 사용)
INSERT OR IGNORE INTO settings (key, value) VALUES ('weekly_send_time', '07:00');
