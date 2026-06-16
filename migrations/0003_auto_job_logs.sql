-- 자동 실행 로그 (Cron Trigger 실행 기록)
CREATE TABLE IF NOT EXISTS auto_job_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL,            -- 'collect' | 'send'
  trigger_type TEXT NOT NULL,        -- 'cron' | 'manual' | 'cron-test'
  status TEXT NOT NULL,              -- 'success' | 'failed' | 'skipped' | 'partial'
  started_at DATETIME NOT NULL,      -- UTC ISO 8601 string (e.g. "2026-06-15T06:58:23.323Z")
  finished_at DATETIME,              -- UTC ISO 8601 string (e.g. "2026-06-15T06:58:30.142Z")
  attempt INTEGER DEFAULT 1,         -- 재시도 회차 (1~3)
  news_collected INTEGER DEFAULT 0,
  emails_sent INTEGER DEFAULT 0,
  emails_failed INTEGER DEFAULT 0,
  error_message TEXT,
  result_json TEXT,                  -- 전체 결과 JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auto_job_logs_started_at ON auto_job_logs(started_at);
CREATE INDEX IF NOT EXISTS idx_auto_job_logs_job_type ON auto_job_logs(job_type, started_at);
