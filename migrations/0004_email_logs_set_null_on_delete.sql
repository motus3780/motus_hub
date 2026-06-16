-- 구독자 삭제 시 email_logs를 보존하기 위해 외래키를 ON DELETE SET NULL 로 변경
-- SQLite는 ALTER TABLE로 FK 변경을 지원하지 않으므로 테이블 재생성 (이력 데이터는 모두 유지)

-- 1) 기존 데이터를 임시 테이블로 보존
CREATE TABLE IF NOT EXISTS email_logs_old AS SELECT * FROM email_logs;

-- 2) 기존 테이블/인덱스 삭제
DROP INDEX IF EXISTS idx_email_logs_date;
DROP INDEX IF EXISTS idx_email_logs_status;
DROP TABLE email_logs;

-- 3) 새 스키마로 재생성 (ON DELETE SET NULL)
CREATE TABLE email_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscriber_id INTEGER,
  recipient TEXT NOT NULL,
  send_date TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_email_logs_date ON email_logs(send_date);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
CREATE INDEX IF NOT EXISTS idx_email_logs_subscriber ON email_logs(subscriber_id);

-- 4) 데이터 복원
INSERT INTO email_logs (id, subscriber_id, recipient, send_date, status, error_message, created_at)
SELECT id, subscriber_id, recipient, send_date, status, error_message, created_at FROM email_logs_old;

-- 5) 임시 테이블 제거
DROP TABLE email_logs_old;
