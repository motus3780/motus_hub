# 모투스 위클리 webapp — 수정 작업 지시서

이 파일은 Claude Code가 참고하는 작업 지시서입니다.
아래 "수정 작업 목록"의 각 항목을 요청하면, 해당 파일의 정확한 위치를 찾아 수정하세요.

## 프로젝트 개요
- **스택**: Hono + TypeScript + Cloudflare Workers/Pages + D1(SQLite) + R2 + Vite
- **빌드**: `npm run build`
- **배포**: `npx wrangler pages deploy dist --project-name <프로젝트명>`
- 건설·분양·광고 업계 B2B 주간 뉴스레터 자동 발송 서비스

## 작업 시 공통 주의사항
- DB 스키마, 멱등성 로직(`send_jobs`, `email_send_log`), 재시도 로직(`sendEmailWithRetry`)의 동작은 바꾸지 말 것
- 섹션/버튼을 삭제하면 연결된 클라이언트 JS(`public/static/app.js`, `admin.js`)의 이벤트 핸들러도 함께 정리해 콘솔 에러가 안 나게 할 것
- 수정 후 반드시 `npm run build`가 에러 없이 통과하는지 확인할 것

---

# 수정 작업 목록

## A. 메인 페이지 / 관리자 UI 수정 (총 8건)

### A-1. 일간 누적 뉴스 영역을 최하단으로 이동
- 파일: `src/templates/pages.tsx` (renderMainPage 함수)
- `<section class="card daily-supplement">` 블록을 `<main>`의 가장 마지막으로 이동
- (A-3에서 아카이브를 삭제하므로 최종적으로 일간 누적 뉴스가 맨 아래)

### A-2. "지금 새로 수집하기" 버튼 — 일반 구독자 노출 금지
- 파일: `src/templates/pages.tsx`, `public/static/app.js`
- 이미 `${opts.isAdmin ? ... : ''}` 로 분기됨. app.js에서 collect-btn을 비로그인에 노출시키는 로직이 있으면 제거
- `/api/collect` 는 관리자 세션 필수 유지

### A-3. "지난 호 아카이브" 섹션 전체 삭제
- 파일: `src/templates/pages.tsx`, `public/static/app.js`
- `<!-- 위클리 아카이브 -->` 주석의 `<section class="card">` (제목 `📅 지난 호 아카이브`, `id="weekly-archive-grid"`) 블록 전체 삭제
- app.js에서 `weekly-archive-grid`를 채우는 로직도 제거

### A-4. 푸터 문구 수정 + 관리자 로그인 링크 숨김
- 파일: `src/templates/pages.tsx` (`<footer>`)
- "오전 7시" 삭제, 발행 주체를 "모투스 컴퍼니 발행"으로 변경 (예: `매주 월요일 · 모투스 컴퍼니 발행`)
- `<a href="/admin">관리자 로그인</a>` 를 `opts.isAdmin`일 때만 노출하거나 푸터에서 제거
- 상단 `<nav class="topnav">`의 `<a href="/admin">관리자</a>` 도 일반 구독자에게 숨김

### A-5. 관리자 사이드바 "위클리 캘린더" 메뉴 삭제
- 파일: `src/templates/adminPages.tsx` (`<aside class="admin-sidebar">`)
- `<a href="/admin/weekly-events" ...>📅 위클리 캘린더</a>` 메뉴 링크 삭제 (라우트/페이지 함수는 둬도 됨)

### A-6. 대시보드 "즉시 발송" 버튼 + "Cron 테스트" 메뉴 삭제
- 파일: `src/templates/adminPages.tsx` (대시보드 "즉시 실행" 카드)
- `<button ... onclick="runDaily()">📤 즉시 발송 (전체 구독자)</button>` 삭제
- `🧪 Cron 테스트 ...` 안내 문구 + `▶ Cron 테스트: 수집·요약`, `▶ Cron 테스트: 발송` 두 버튼 삭제
- "지금 뉴스 수집 + AI 요약" 버튼은 유지

### A-7. [버그] 위클리 이미지 — 파일 선택 시 미리보기 실시간 렌더링
- 파일: `src/templates/adminPages.tsx` (renderWeeklyImagesPage, `weeklyImages` 객체)
- 원인: `<input type="file">`에 change 핸들러가 없어 선택 직후 `.wi-preview`가 갱신되지 않음 (업로드 후 loadSections 재호출 때만 보임)
- 수정: 카테고리 대표 이미지 카드(`data-key`)와 호별 TOP 이미지 카드(`data-slot`) 양쪽의 `<input type="file">`에 change 리스너 추가 → 선택 즉시 `URL.createObjectURL(file)`로 `.wi-preview`에 `<img>` 렌더
- 이미지 아닌 파일은 미리보기 표시 안 함, 이전 objectURL은 `URL.revokeObjectURL`로 해제
- 실제 업로드는 기존 업로드 버튼 로직 유지

### A-8. 위클리 이미지 — 노출 위치 안내 + 누락 버그 점검
- 파일: `src/templates/adminPages.tsx`, `src/templates/email.ts`
- 각 이미지 카드에 "메일 어느 위치에 노출되는지" 안내 문구 추가 (카테고리 대표 → 섹션 제목 아래 / 슬롯1 → TOP3 위 메인 배너 / 슬롯2 → 서브 배너)
- "위클리 메일로 테스트" 발송 시 적용 이미지 장수 정상 표시 확인
- email.ts에서 등록된 이미지가 렌더링 누락되는 버그가 있으면 수정

---

## B. [중요] "즉시 발송" 메일이 너무 늦게 도착하는 문제

### 원인 (분석 완료)
- "즉시 발송" → `POST /admin/api/run-daily` → `runDailyJob()` 호출
- `runDailyJob()`은 발송 전에 ① 뉴스 수집(네이버 API) ② AI 요약(Claude API, 10~30초+)을 먼저 실행한 뒤 발송함
- 테스트 메일은 저장된 요약으로 `sendEmail()` 1회만 호출 → 즉시 도착
- 즉, 지연 원인은 발송이 아니라 매번 수집+요약이 다시 도는 것

### B-1. "즉시 발송"은 수집·요약 건너뛰고 저장된 최신 요약으로 발송만
- 파일: `src/routes/admin.ts` (`/run-daily`), `src/lib/dailyJob.ts` (runDailyJob)
- `/run-daily`가 `runDailyJob`을 `skipCollect: true`로 호출
- runDailyJob의 "2) AI 요약 생성" 단계: `skipCollect: true`면 저장된 오늘자 요약(getSummaryByDate)이 있으면 그대로 사용, generateSummary(Claude) 재실행 금지. 저장된 요약이 없을 때만 생성하고 에러로 처리하지 않음
- "지금 뉴스 수집 + AI 요약" 버튼(`/collect-now`)은 그대로 유지

### B-2. 발송을 백그라운드(waitUntil)로 처리
- 파일: `src/routes/admin.ts` (`/run-daily`)
- 참고: `src/index.tsx`의 Cron 핸들러는 이미 `ctx.waitUntil(...)` 사용 (약 234줄)
- `/run-daily`에서 runDailyJob 실행을 `c.executionCtx.waitUntil(...)`로 감싸고, 즉시 `{ ok:true, started:true }` 응답
- 진행상황은 기존 `/send-progress` 폴링으로 확인 (admin.js의 runDaily가 이미 폴링)
- 백그라운드 예외 시 멱등성 락이 정상 해제(releaseSendJob)되게 유지

### B-3. (선택) 소규모 구독자일 때 발송 간격 단축
- 파일: `src/lib/dailyJob.ts`, `src/lib/weeklyJob.ts`
- `SEND_DELAY_MS = 600`. 구독자 20명 미만이면 350ms 정도로 단축 (Resend 무료플랜 초당 2건 한도 내)

### B-4. 위클리 발송도 동일 패턴 적용
- `runWeeklyJob`도 B-2와 같은 백그라운드 처리 적용

---

## 코드로 해결되지 않는 부분 (참고)
- 위 수정 후에도 메일 "배달" 자체가 느리면 Resend 발신 도메인 문제임
- `onboarding@resend.dev`(테스트용 공용 주소) 대신 본인 도메인(motusdaily.co.kr)을 Resend에 등록하고 SPF/DKIM/DMARC 설정 후, 환경설정의 `sender_email`을 인증된 주소로 변경
- 이건 Resend 대시보드에서 직접 하는 작업 (코드 수정 아님)
