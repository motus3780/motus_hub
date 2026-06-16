-- 모투스컴퍼니 건설·분양 데일리 뉴스레터 DB 스키마

-- 환경설정 (key-value 저장)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 관리자 계정
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 수집된 뉴스
CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  link TEXT UNIQUE NOT NULL,
  source TEXT,
  pub_date DATETIME,
  category TEXT NOT NULL,
  collected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  collection_date TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_date ON news(collection_date);
CREATE INDEX IF NOT EXISTS idx_news_category ON news(category);

-- 일별 AI 요약
CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  summary_date TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  article_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_summaries_date ON summaries(summary_date);

-- 구독자
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  active INTEGER DEFAULT 1,
  unsubscribe_token TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  unsubscribed_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_subscribers_active ON subscribers(active);
CREATE INDEX IF NOT EXISTS idx_subscribers_token ON subscribers(unsubscribe_token);

-- 이메일 발송 로그
CREATE TABLE IF NOT EXISTS email_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscriber_id INTEGER,
  recipient TEXT NOT NULL,
  send_date TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subscriber_id) REFERENCES subscribers(id)
);
CREATE INDEX IF NOT EXISTS idx_email_logs_date ON email_logs(send_date);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);

-- 자사 콘텐츠 (모투스컴퍼니 소식)
CREATE TABLE IF NOT EXISTS company_contents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL,
  image_url TEXT,
  external_link TEXT,
  start_date TEXT,
  end_date TEXT,
  show_in_email INTEGER DEFAULT 1,
  is_pinned INTEGER DEFAULT 0,
  status TEXT DEFAULT 'draft',
  view_count INTEGER DEFAULT 0,
  click_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_company_contents_status ON company_contents(status);
CREATE INDEX IF NOT EXISTS idx_company_contents_dates ON company_contents(start_date, end_date);

-- 콘텐츠 클릭 로그
CREATE TABLE IF NOT EXISTS content_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (content_id) REFERENCES company_contents(id)
);
CREATE INDEX IF NOT EXISTS idx_content_clicks_content ON content_clicks(content_id);

-- 관리자 세션
CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  FOREIGN KEY (admin_id) REFERENCES admins(id)
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);
