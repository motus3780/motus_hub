-- 뉴스 검색 성능을 위한 인덱스 추가
-- LIKE 검색은 인덱스를 직접 사용하지 못하지만, 카테고리/날짜/언론사/정렬용 보조 인덱스로 필터 성능을 개선합니다.

CREATE INDEX IF NOT EXISTS idx_news_category ON news(category);
CREATE INDEX IF NOT EXISTS idx_news_source ON news(source);
CREATE INDEX IF NOT EXISTS idx_news_pub_date ON news(pub_date);
CREATE INDEX IF NOT EXISTS idx_news_collection_date_category ON news(collection_date, category);
CREATE INDEX IF NOT EXISTS idx_news_pub_date_desc ON news(pub_date DESC);
