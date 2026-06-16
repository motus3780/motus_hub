-- 정치 콘텐츠 필터링: 격리(excluded) 기사 테이블
-- ─────────────────────────────────────────────────────────────────────
-- 수집 단계에서 정치 키워드/정치인/URL 패턴에 매칭된 기사는 news 테이블이
-- 아니라 이 테이블에 격리됩니다. 사후 검토·운영 리포트·소급 분석에 사용.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS excluded_articles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  description     TEXT,
  link            TEXT NOT NULL,                  -- 원문 URL (UNIQUE 아님 — 같은 기사가 여러 쿼리로 잡힐 수 있음)
  source          TEXT,
  pub_date        DATETIME,
  category        TEXT,                            -- 수집 시도된 카테고리 (제외되었으므로 정식 분류는 아님)
  collection_date TEXT NOT NULL,                   -- 'YYYY-MM-DD' (KST)
  excluded_reason TEXT NOT NULL,                   -- 사유(직렬화): "URL 패턴 매칭: /politics/" 등
  matched_keywords TEXT,                           -- 매칭된 키워드 JSON 배열 (예: ["민주당","공약"])
  matched_politicians TEXT,                        -- 매칭된 정치인 JSON 배열
  matched_url_patterns TEXT,                       -- 매칭된 URL 패턴 JSON 배열
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_excluded_articles_collection_date
  ON excluded_articles(collection_date);

CREATE INDEX IF NOT EXISTS idx_excluded_articles_category
  ON excluded_articles(category);

-- 같은 (link, collection_date) 중복 시도 방지 (수집 사이클 내 중복 격리 방지)
CREATE UNIQUE INDEX IF NOT EXISTS uq_excluded_articles_link_date
  ON excluded_articles(link, collection_date);
