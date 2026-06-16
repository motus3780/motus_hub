-- 0010_personalized_operator_review.sql
-- 운영 권고 반영: 회사별 위클리 발송 라우팅 + 운영자 1차 검수 시스템
--
-- (1) weekly_personalized_summaries 에 operator_review 컬럼 추가
--     - 자동 검증(verifyCompanySummary)이 통과하더라도, 발송 전 운영자가 본문을 검토하고
--       "부정적 사실 누락 없음 / 회사 메시지 관점 OK" 등을 명시적으로 승인했는지 기록
--     - operator_review_status: pending | approved | rejected
--     - operator_review_notes: 운영자 메모 (예: "5/13 자이 신반포 분양 누락 확인 — 추가 필요")
--     - operator_reviewed_by: 검수자 admin user id
--     - operator_reviewed_at: 검수 시각
--
-- (2) status 의미 확장
--     - 'draft'   : 생성 직후
--     - 'held'    : 자동 검증 실패 (verifyCompanySummary 경고 ≥1개)
--     - 'ready'   : 자동 검증 통과, 운영자 검수 대기
--     - 'approved': 운영자 1차 검수 통과 (발송 가능)
--     - 'sent'    : 발송 완료
--
-- (3) 회사별 발송 이력 추적: send_jobs 의 job_id 패턴
--     - 일반본:    weekly_2026-05-04
--     - 회사 맞춤: weekly_2026-05-04_gs / weekly_2026-05-04_hyundai ...

ALTER TABLE weekly_personalized_summaries ADD COLUMN operator_review_status TEXT DEFAULT 'pending';
ALTER TABLE weekly_personalized_summaries ADD COLUMN operator_review_notes TEXT;
ALTER TABLE weekly_personalized_summaries ADD COLUMN operator_reviewed_by INTEGER;
ALTER TABLE weekly_personalized_summaries ADD COLUMN operator_reviewed_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_weekly_personalized_review_status
  ON weekly_personalized_summaries(operator_review_status);
