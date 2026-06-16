# 🏗️ 건설·분양 위클리 by 모투스

## 프로젝트 개요
- **이름**: 건설·분양 위클리 (모투스 B2B 뉴스레터 서비스)
- **목표**: 매주 월요일 오전 7시 KST에 직전 1주(월~일)의 건설·분양·광고/매체 뉴스를 자동 집계하고 Claude AI로 시장 한 줄 요약 + TOP 3 핵심 이슈 + 본문으로 정리하여 자사 콘텐츠와 함께 구독자에게 이메일 발송
- **도메인**: motusdaily.co.kr (위클리로 전환되었지만 도메인은 유지)
- **스택**: Hono + TypeScript + Cloudflare Workers/Pages + D1 (SQLite) + R2 + Vite

## 🌐 URL
- **개발 (Sandbox)**: 포트 3000에서 PM2로 실행 (`GetServiceUrl` 으로 공개 URL 발급)
- **메인 페이지**: `/` (이번 호 + 위클리 아카이브 카드 그리드)
- **위클리 아카이브 상세**: `/archive/:week_start_date` (예: `/archive/2026-05-18`)
- **관리자 콘솔**: `/admin` → `/admin/dashboard`
- **위클리 캘린더 (관리자)**: `/admin/weekly-events`

## ✅ 구현 완료 기능 (Step 1 ~ 11)

### 1. 위클리 DB 스키마 (Step 1)
- `weekly_summaries` (week_start_date UNIQUE, vol_no, issue_date, market_oneliner, content)
- `weekly_top_news` (week_start_date + rank UNIQUE, TOP 3)
- `weekly_events` (관리자 입력 일정, 이번 주/다음 주)
- `weekly_summary_tags` (아카이브 카드 태그)
- `settings.weekly_vol_counter` (일간 누적 VOL 이어받기)

### 2. 위클리 도우미 (Step 2)
- KST 기준 `getLastWeekRange()` — 직전 주 월~일 + 발행 월요일
- `getWeekStartOf(date)` — 임의 날짜의 같은 주 월요일
- `formatIssueLabelKo` (`2026년 5월 4주차`) / `formatWeekRangeKo` (`5/18(월) ~ 5/24(일)`) / `formatNextIssueKo`
- `consumeNextVolNo` — VOL 카운터 원자적 증가

### 3. 위클리 뉴스 집계 + TOP 3 (Step 3)
- 직전 1주(7일) 전체 뉴스 풀에서 카테고리·매체 다양성을 고려한 점수화로 TOP 3 자동 선정

### 4. 위클리 AI 요약 (Step 4)
- Claude (`claude-haiku-4-5-20251001`)에 주간 프롬프트 전달
- 시장 한 줄 요약 + 본문 마크다운 + TOP 3 컨텍스트 정리
- `getLatestWeeklySummary` / `getRecentWeeklySummaries` / `getWeeklySummary` 조회 함수

### 5. 위클리 발송 잡 + 이메일 템플릿 (Step 5)
- `runWeeklyJob(env, opts)` — 수집·요약 → 저장 → 발송 → 멱등성 처리
- `renderWeeklyEmail` — VOL 라벨 / 시장 한 줄 / TOP 3 카드 / 본문 / 다음 호 예고 / 발신자 풋터
- `makeWeeklyJobId(weekStart)` = `weekly_2026-05-18` (Idempotency 키)
- `send_jobs.job_id` + `email_send_log` UNIQUE로 중복 발송 차단

### 6. 자동화 크론 (Step 6)
- `wrangler.jsonc`: `crons = ["30 21 * * *", "0 22 * * 0"]`
  - `30 21 * * *` (KST 매일 06:30) → **수집만** (위클리 집계 풀 준비)
  - `0 22 * * 0` (KST 매주 월요일 07:00) → **위클리 발송**
- `autoJob.ts` `runScheduledByTime` — 월요일 위클리 우선 처리, 그 외 요일은 수집만
- `hasCompletedThisWeek` — 같은 주 중복 발송 방지

### 7. 메인 페이지 위클리 리뉴얼 + BETA fallback (Step 7)
- `/` 메인 카드: VOL 라벨, 발행일, 주차 범위, 시장 한 줄, TOP 3 카드, 다음 호 예고
- 아직 발행된 위클리 호가 없으면 BETA 안내 카드 표시
- JSON-LD `Article` 스키마 + OG 메타 (og:type / title / description / site_name / image)

### 8. 관리자 분리 & 보안 + 위클리 캘린더 UI (Step 8)
- `requireAdmin` 미들웨어 강화 — `/api/*`·`/admin/api/*`·`Accept: application/json` 모두 401 JSON 응답
- `/api/collect` (수동 수집 트리거) — **관리자 세션 필수**
- 메인 페이지 `🔄 지금 새로 수집하기` 버튼 — `isAdmin` 게이팅으로 비로그인 시 노출 안 됨
- `/admin/weekly-events` 페이지 + `/admin/api/weekly-events` CRUD (`GET / POST / GET:id / PUT:id / DELETE:id`)
- 이벤트 타입 8종(청약·견본주택·입찰·정책·금리·공급·발표·기타) × 섹션 2종(이번 주/다음 주)

### 9. 아카이브 카드 레이아웃 + 태그 (Step 9)
- 메인 페이지 아카이브 → 반응형 카드 그리드
- 카드 구성: VOL.번호 / 발행일 라벨 / 주차 범위 / 시장 한 줄 (3줄 클램프) / 태그 칩 + 기사 수
- `weeklyTags.ts` — `WEEKLY_TAG_POOL = ['PF','청약','정책','브랜드','금리','입찰','공급']`
- 키워드 사전 기반 자동 추출 (점수 상위 4개), 동률 시 풀 순서
- `saveWeeklySummary()` 안에서 자동 호출 → `weekly_summary_tags` UPSERT

### 10. 전역 브랜드 리네임 (Step 10)
- 코드 11개 파일 18곳 일괄 치환 (`모투스컴퍼니 데일리` → `모투스 위클리`)
- DB 마이그레이션 `0007_brand_rename.sql` — `settings.sender_name` UPDATE
- 외부 매체명(`이데일리 / 디지털데일리 / 뉴데일리`)과 히스토리 마이그레이션(0001)은 보존

### 11. 통합 검증 + 운영 문서화 (Step 11)
- `runWeeklyJob` end-to-end 시뮬레이션 (수집 → AI 요약 → 저장 → 태그 자동 추출 → 발송 → 멱등성)
- README 위클리 워크플로우로 전면 재작성

## 📡 주요 엔드포인트

### 공개 페이지
| 경로 | 설명 |
|---|---|
| `GET /` | 메인 페이지 (이번 호 + 위클리 아카이브 그리드) |
| `GET /archive/:week_start_date` | 위클리 호 상세 (예: `/archive/2026-05-18`) |
| `GET /content/:id` | 자사 콘텐츠 상세 |
| `GET /c/:id/click?source=email&redirect=URL` | 클릭 추적 후 리다이렉트 |
| `GET /unsubscribe?token=...` | 구독 해지 |
| `GET /r2/*` | R2 업로드 이미지 서빙 |

### 공개 API
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/today` | 메인 페이지 초기 데이터 (위클리 호 + 자사 콘텐츠) |
| GET | `/api/archive/:date` | 위클리 호 상세 (date = week_start_date) |
| **GET** | **`/api/weekly-summaries?limit=12`** | **위클리 아카이브 카드용 목록 (vol/issue_label/week_range/tags)** |
| GET | `/api/summaries?limit=14` | (레거시) 일간 요약 목록 |
| GET | `/api/contents` | 활성 자사 콘텐츠 목록 |
| GET | `/api/content/:id` | 콘텐츠 상세 (조회수 +1) |
| POST | `/api/content/:id/click` | 클릭 기록 |
| POST | `/api/subscribe` | `{email, name?}` 구독 신청 |
| POST | `/api/unsubscribe` | `{token}` 구독 해지 |
| POST | `/api/collect` | **관리자 전용** 수동 수집 (인증 필요) |
| GET | `/api/news/search` | 뉴스 검색 |
| GET | `/api/news-sources` | 매체 목록 |

### 관리자 페이지 (쿠키 인증)
| 경로 | 설명 |
|---|---|
| `GET /admin/login` | 로그인 |
| `GET /admin/dashboard` | 대시보드 |
| `GET /admin/contents` | 자사 콘텐츠 |
| **`GET /admin/weekly-events`** | **위클리 캘린더 (이번 주 / 다음 주 일정)** |
| `GET /admin/subscribers` | 구독자 |
| `GET /admin/email-logs` | 발송 이력 |
| `GET /admin/settings` | 환경 설정 |
| `GET /admin/news-search` | 뉴스 검색 |
| `GET /admin/media-mapping` | 매체 매핑 |

### 관리자 API (`/admin/api/...`)
- **인증**: `POST /login`, `POST /logout`, `GET /me`, `POST /change-password`
- **콘텐츠**: `GET/POST /contents`, `GET/PUT/DELETE /contents/:id`, `POST /contents/:id/duplicate`, `POST /upload`
- **구독자**: `GET/POST /subscribers`, `DELETE /subscribers/:id`, `GET /subscribers.csv`
- **로그/대시보드**: `GET /email-logs`, `GET /dashboard`
- **운영**: `POST /run-daily` (수집), `POST /collect-now`, `POST /run-weekly` (위클리 발송)
- **위클리 캘린더**: `GET/POST /weekly-events`, `GET/PUT/DELETE /weekly-events/:id`
- **설정**: `GET/PUT /settings`

## 🗄️ 데이터 아키텍처

### 저장소
- **Cloudflare D1** (SQLite, 영구 저장)
- **Cloudflare R2** (이미지 영구 저장)

### 주요 테이블
| 테이블 | 용도 |
|---|---|
| `settings` | 환경 변수 (sender_name, weekly_vol_counter, weekly_mode_enabled 등) |
| `admins`, `admin_sessions` | 관리자 / 7일 세션 |
| `news` | 수집된 뉴스 (link UNIQUE) |
| **`weekly_summaries`** | **주간 호** (week_start_date UNIQUE, vol_no, issue_date, market_oneliner, content) |
| **`weekly_top_news`** | **TOP 3** ((week_start_date, rank) UNIQUE) |
| **`weekly_events`** | **관리자 캘린더** (this_week / next_week × 8 타입) |
| **`weekly_summary_tags`** | **아카이브 태그** (PF·청약·정책·브랜드·금리·입찰·공급) |
| `summaries` | (레거시) 일간 요약 |
| `subscribers` | 이메일/이름/활성/해지 토큰 |
| `email_logs`, `email_send_log` | 발송 로그 |
| `send_jobs` | 발송 잡 멱등성 키 (job_id UNIQUE) |
| `auto_job_logs` | 자동 실행 이력 |
| `company_contents` | 자사 콘텐츠 |
| `content_clicks` | 클릭 로그 |

### 마이그레이션
- `0001_initial_schema.sql` ~ `0006_weekly_support.sql` ~ **`0007_brand_rename.sql`** (총 7개)

### 데이터 플로우
```
[매일 06:30 KST]  Cron → 뉴스 수집 → news INSERT (위클리 풀에 누적)

[월요일 07:00 KST]
  Cron → runWeeklyJob:
    1. getLastWeekRange()로 직전 주 월~일 결정
    2. weekly news 풀에서 TOP 3 선정 + 점수화
    3. Claude로 시장 한 줄 + 본문 + TOP 3 정리
    4. saveWeeklySummary:
       - weekly_summaries UPSERT (vol_no는 consumeNextVolNo로 원자 증가)
       - weekly_top_news DELETE→INSERT
       - extractAndSaveTags: weekly_summary_tags 자동 갱신
    5. 활성 subscribers + 이메일 노출 자사 콘텐츠 + weekly_events(this_week)
       → renderWeeklyEmail → MailChannels/Resend 발송
    6. send_jobs / email_send_log 기록 (멱등성)
```

## 🚀 사용 가이드 (운영진)

### 최초 셋업
1. 사이트 접속 → 자동으로 `/admin/setup` 이동
2. 관리자 ID/비밀번호 + API 키 입력 후 "셋업 완료"
   - 네이버 검색 API: https://developers.naver.com/apps/#/register
   - Claude API: https://console.anthropic.com/
   - 발송: **Resend** (`RESEND_API_KEY` wrangler secret) 또는 MailChannels

### 일상 운영
1. **자사 콘텐츠 등록**: 좌측 "자사 콘텐츠" → "+ 새 콘텐츠 등록"
2. **위클리 캘린더**: 좌측 "📅 위클리 캘린더" → 이번 호의 "이번 주 일정" / "다음 주 일정" 입력
3. **위클리 발송**: 매주 월요일 07:00 KST 자동 (수동 트리거: 대시보드 → "위클리 발송")
4. **모니터링**: 대시보드의 발송 성공/실패, 콘텐츠 클릭, 자동 실행 로그
5. **구독자 관리**: CSV 내보내기 / 수동 추가/삭제

### Cron 트리거
- `30 21 * * *` (UTC) = 매일 KST 06:30 → 뉴스 수집만
- `0 22 * * 0` (UTC) = 매주 일요일 22:00 UTC = 매주 월요일 07:00 KST → 위클리 발송
- 같은 주 중복 발송은 `send_jobs.job_id = weekly_${weekStart}`로 차단

## 🚢 배포 (Cloudflare Pages)

```bash
# 1. Cloudflare API 키 설정 (Deploy 탭)
# 2. D1 프로덕션 DB 생성 (최초 1회)
npx wrangler d1 create webapp-production
# wrangler.jsonc의 database_id 갱신

# 3. R2 버킷 생성 (최초 1회)
npx wrangler r2 bucket create webapp-uploads

# 4. 마이그레이션 (0001 ~ 0007)
npx wrangler d1 migrations apply webapp-production

# 5. Resend secret
npx wrangler pages secret put RESEND_API_KEY --project-name <cloudflare_project_name>

# 6. 배포
npm run build
npx wrangler pages deploy dist --project-name <cloudflare_project_name>
```

## 🛠️ 로컬 개발

```bash
# 의존성 (최초 1회)
npm install

# DB 마이그레이션 (로컬)
npx wrangler d1 migrations apply webapp-production --local

# 빌드 + PM2 실행
npm run build
pm2 start ecosystem.config.cjs

# 로그
pm2 logs webapp --nostream

# 서비스 중단
pm2 delete webapp
```

## 📌 미구현 / 추가 발전
- 운영 환경 weekly_vol_counter 초기값 확정 (현재 로컬 = summaries row 수)
- 위클리 발송 큐잉 (대규모 구독자 대응)
- 위클리 아카이브 검색 / 태그별 필터링
- A/B 제목 테스트
- 클릭 히트맵 / 시각 분석

## 🎨 디자인
- **메인 컬러**: 네이비(#2c3e50) ↔ 블루(#3498db) 그라데이션
- **자사 콘텐츠**: 골드(#f0c14b) 톤 강조 보더
- **구독 CTA**: 따뜻한 오렌지 그라데이션
- **태그 칩**: 7색 컬러 시스템 (PF/청약/정책/브랜드/금리/입찰/공급)
- **폰트**: Pretendard (CDN)
- **반응형**: 모바일 대응

## 📅 마지막 업데이트
2026-06-01 (위클리 전환 11단계 완료)
