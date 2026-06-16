-- 발송 작업 멱등성(Idempotency) 보장
-- 1) send_jobs: 발송 작업 단위(날짜별 1건). 동시 실행 락 + 완료 여부 판정.
-- 2) email_send_log: (job_id, subscriber_id) 유니크 - 동일 작업에서 동일 구독자 중복 발송 방지

CREATE TABLE IF NOT EXISTS send_jobs (
  job_id           TEXT PRIMARY KEY,           -- 'newsletter_2026-05-09'
  scheduled_date   TEXT NOT NULL,              -- 'YYYY-MM-DD' (KST)
  trigger_type     TEXT NOT NULL DEFAULT 'cron', -- 'cron' | 'manual' | 'cron-test'
  status           TEXT NOT NULL DEFAULT 'pending', -- pending | running | completed | failed
  started_at       DATETIME,                   -- UTC ISO
  completed_at     DATETIME,                   -- UTC ISO
  total_count      INTEGER DEFAULT 0,
  success_count    INTEGER DEFAULT 0,
  failed_count     INTEGER DEFAULT 0,
  retry_count      INTEGER DEFAULT 0,          -- 작업 재시도(외부) 회차
  estimated_seconds INTEGER DEFAULT 0,         -- 예상 소요 시간(초)
  error_message    TEXT,
  worker_token     TEXT,                       -- 락을 잡은 인스턴스 식별자
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_send_jobs_date    ON send_jobs(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_send_jobs_status  ON send_jobs(status);

-- 개별 구독자 단위 멱등성 로그
CREATE TABLE IF NOT EXISTS email_send_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id          TEXT NOT NULL,
  subscriber_id   INTEGER,                      -- NULL 가능(구독자 삭제 후 보존)
  recipient       TEXT NOT NULL,
  status          TEXT NOT NULL,                -- 'success' | 'failed'
  resend_id       TEXT,                         -- Resend 응답의 메시지 ID
  attempts        INTEGER DEFAULT 1,
  error_code      TEXT,                         -- 'RATE_LIMIT' | '4XX' | '5XX' | 'NETWORK' | 'OK' 등
  error_message   TEXT,
  sent_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES send_jobs(job_id) ON DELETE CASCADE,
  FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE SET NULL
);

-- (job_id, subscriber_id) 유니크: subscriber_id가 NULL이면 (이미 삭제된 구독자) recipient 기준으로 보호
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_send_log_job_sub
  ON email_send_log(job_id, subscriber_id)
  WHERE subscriber_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_send_log_job_recipient
  ON email_send_log(job_id, recipient);

CREATE INDEX IF NOT EXISTS idx_email_send_log_job ON email_send_log(job_id);
CREATE INDEX IF NOT EXISTS idx_email_send_log_subscriber ON email_send_log(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_email_send_log_sent_at ON email_send_log(sent_at);
