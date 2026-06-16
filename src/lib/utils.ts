// 시간대 / 유틸 함수
//
// === TZ 정책 (2026-06-15 정정) ===
//  ❶ DB의 모든 timestamp 컬럼(created_at, started_at, completed_at, finished_at, sent_at)
//     은 UTC ISO 8601 문자열("YYYY-MM-DDTHH:mm:ss.sssZ")로 저장한다.
//     → 코드에서는 `nowUtcIso()` 또는 `new Date().toISOString()` 사용.
//     → SQLite `CURRENT_TIMESTAMP` 기본값도 UTC이므로 정책 동일.
//  ❷ KST 변환은 *오직 표시 단계*에서만 수행한다.
//     → 클라이언트: `formatKST(utcIso)` (admin.js)
//     → 서버: `nowKSTString()` (UI 출력 한정), `nowKST()` (cron 매칭 한정)
//  ❸ `nowKST()` / `nowKSTString()` 은 DB INSERT용으로 사용 금지.
//     - `nowKST()` 가 반환하는 Date는 "+9시간이 더해진 가짜 UTC" 이므로
//       `.toISOString()` 을 하면 'Z'(UTC) 접미사가 붙은 잘못된 ISO가 만들어진다.
//     - 호출 위치가 cron 시각 매칭처럼 KST 달력 계산 용도일 때만 허용한다.

// KST(Asia/Seoul, UTC+9) "달력 계산" 전용. 절대 DB에 저장 금지.
// 반환 Date 객체는 getUTCFullYear() / getUTCHours() 로 읽으면 KST 값이 나온다.
export function nowKST(): Date {
  const now = new Date()
  return new Date(now.getTime() + 9 * 60 * 60 * 1000)
}

// KST 기준 YYYY-MM-DD (오늘 날짜) — cron 매칭, 발송일자 식별용
export function todayKST(): string {
  const d = nowKST()
  return d.toISOString().slice(0, 10)
}

// 현재 시각의 UTC ISO 문자열 ("...Z") — DB 저장의 정식 헬퍼
// 이 값을 DB에 넣고, 화면에서는 KST로 변환해 표시한다.
export function nowUtcIso(): string {
  return new Date().toISOString()
}

// @deprecated DB 저장용으로 사용 금지. 사람이 읽는 로그/표시용으로만 쓸 것.
// 반환: "YYYY-MM-DD HH:mm" (KST, 시간대 표시 없음)
export function nowKSTString(): string {
  const d = nowKST()
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mi = String(d.getUTCMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

// UTC ISO ("...Z") → KST "YYYY-MM-DD HH:mm:ss" 변환 (서버측 표시 헬퍼)
// 클라이언트 표시는 admin.js의 formatKST() 사용.
export function formatKstFromUtc(utcIso: string | null | undefined): string {
  if (!utcIso) return ''
  const t = new Date(utcIso).getTime()
  if (Number.isNaN(t)) return String(utcIso)
  const k = new Date(t + 9 * 60 * 60 * 1000)
  const yyyy = k.getUTCFullYear()
  const mm = String(k.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(k.getUTCDate()).padStart(2, '0')
  const hh = String(k.getUTCHours()).padStart(2, '0')
  const mi = String(k.getUTCMinutes()).padStart(2, '0')
  const ss = String(k.getUTCSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`
}

// HTML 태그 / 특수문자 정리
export function cleanText(s: string): string {
  if (!s) return ''
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// 한국어 날짜 표시
export function formatKoreanDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00+09:00')
  const yyyy = d.getFullYear()
  const mm = d.getMonth() + 1
  const dd = d.getDate()
  const days = ['일', '월', '화', '수', '목', '금', '토']
  const dow = days[d.getDay()]
  return `${yyyy}년 ${mm}월 ${dd}일 (${dow})`
}

// 랜덤 토큰 생성
export function generateToken(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const arr = new Uint8Array(length)
  crypto.getRandomValues(arr)
  let token = ''
  for (let i = 0; i < length; i++) {
    token += chars[arr[i] % chars.length]
  }
  return token
}

// SHA-256 해시 (비밀번호 해시용 - bcryptjs는 Workers 호환성 이슈 가능성)
export async function sha256(text: string, salt: string = 'motus_salt_2026'): Promise<string> {
  const data = new TextEncoder().encode(text + salt)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// 이메일 형식 검증
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// 마크다운 → HTML (간단 변환)
export function markdownToHtml(md: string): string {
  if (!md) return ''
  let html = md
  // 코드 블록
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
  // 인라인 코드
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  // 헤더
  html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>')
  // 굵게/기울임
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  // 링크
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
  // 이미지
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;" />')
  // 리스트
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
  // 줄바꿈
  html = html.replace(/\n\n/g, '</p><p>')
  html = '<p>' + html + '</p>'
  html = html.replace(/<p>(<h[1-3]>)/g, '$1')
  html = html.replace(/(<\/h[1-3]>)<\/p>/g, '$1')
  html = html.replace(/<p>(<ul>)/g, '$1')
  html = html.replace(/(<\/ul>)<\/p>/g, '$1')
  html = html.replace(/<p>(<pre>)/g, '$1')
  html = html.replace(/(<\/pre>)<\/p>/g, '$1')
  html = html.replace(/<p><\/p>/g, '')
  return html
}

// HTML escape
export function escapeHtml(s: string): string {
  if (!s) return ''
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ──────────────────────────────────────────────────────────────────────
// 주간(Weekly) 발행 관련 KST 헬퍼
// 결정사항:
//   ❶ 주 시작일 = KST 월요일 (week_start_date: YYYY-MM-DD)
//   Q2 주간 범위 = 직전 주 월~일 (전체 7일)
//   발송 = 매주 월요일 KST 07:00
// ──────────────────────────────────────────────────────────────────────

// KST YYYY-MM-DD → "KST 자정"을 UTC 자정으로 표현하는 Date (읽기 편의)
// 주의: 이렇게 만든 Date는 시계 시각이 아닌 "KST 달력 날짜 표현용" Date임.
// 따라서 getUTCFullYear/Month/Date/Day를 그대로 사용하면 KST 달력 값이 나온다.
function kstDateFromYMD(ymd: string): Date {
  // 'T00:00:00Z'를 사용 → UTC 자정 = 동일 날짜 표현
  return new Date(ymd + 'T00:00:00Z')
}

// YYYY-MM-DD 포맷 (KST 기준 Date 객체 입력)
function toYMD(d: Date): string {
  // d를 KST로 해석 (UTC+9)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const yyyy = kst.getUTCFullYear()
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(kst.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// "이번 호의 주간 범위" = 직전 주 월~일 (Q2=B)
// 발송 기준일(referenceDate)이 월요일이라면, 그 전주 월(=referenceDate-7일)~일(=referenceDate-1일)
// referenceDate를 안 주면 nowKST() 기준
export interface WeekRange {
  weekStart: string   // YYYY-MM-DD (월요일 KST)
  weekEnd: string     // YYYY-MM-DD (일요일 KST)
  issueDate: string   // YYYY-MM-DD (발행일 = 발송 월요일 KST)
}

export function getLastWeekRange(referenceDate?: Date): WeekRange {
  const ref = referenceDate ?? nowKST()
  // ref를 KST 자정으로 정규화 (UTC로 표현된 KST 시각이므로 getUTCDay 사용)
  const refKst = referenceDate
    ? new Date(referenceDate.getTime() + 9 * 60 * 60 * 1000)
    : ref // nowKST()는 이미 +9 적용됨

  // getUTCDay(): 0=일, 1=월, ..., 6=토 (KST 요일)
  const dow = refKst.getUTCDay()
  // 이번 주 월요일까지의 일수 (월=0, 일=6)
  const daysFromMonday = (dow + 6) % 7
  // 이번 주 월요일 (KST 00:00)
  const thisMondayUtcMs = Date.UTC(
    refKst.getUTCFullYear(),
    refKst.getUTCMonth(),
    refKst.getUTCDate() - daysFromMonday
  )
  // 직전 주 월요일 = 이번 주 월요일 - 7일
  const lastMonday = new Date(thisMondayUtcMs - 7 * 24 * 60 * 60 * 1000)
  const lastSunday = new Date(thisMondayUtcMs - 1 * 24 * 60 * 60 * 1000)
  const thisMonday = new Date(thisMondayUtcMs)

  // YYYY-MM-DD 추출 (UTC 자정으로 만들었으므로 그대로 사용)
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`

  return {
    weekStart: fmt(lastMonday),
    weekEnd: fmt(lastSunday),
    issueDate: fmt(thisMonday),
  }
}

// 한국어 주간 범위 표시: "5/26(월) ~ 5/30(일)"
export function formatWeekRangeKo(weekStart: string, weekEnd: string): string {
  const s = kstDateFromYMD(weekStart)
  const e = kstDateFromYMD(weekEnd)
  const days = ['일', '월', '화', '수', '목', '금', '토']
  const sm = s.getUTCMonth() + 1
  const sd = s.getUTCDate()
  const sw = days[s.getUTCDay()]
  const em = e.getUTCMonth() + 1
  const ed = e.getUTCDate()
  const ew = days[e.getUTCDay()]
  return `${sm}/${sd}(${sw}) ~ ${em}/${ed}(${ew})`
}

// 한국어 발행 호 표시: "2026년 5월 4주차"
// 월 내 N주차 = 해당 월요일이 그 달의 몇 번째 월요일인지
export function formatIssueLabelKo(weekStart: string): string {
  const d = kstDateFromYMD(weekStart)
  const yyyy = d.getUTCFullYear()
  const mm = d.getUTCMonth() + 1
  const dd = d.getUTCDate()
  const weekOfMonth = Math.ceil(dd / 7)
  return `${yyyy}년 ${mm}월 ${weekOfMonth}주차`
}

// 다음 호 발행 예정일 = 이번 호 발행일 + 7일
// 표시 예: "6월 2일(월) 오전 7시"
export function formatNextIssueKo(currentIssueDate: string): string {
  const cur = kstDateFromYMD(currentIssueDate)
  const next = new Date(cur.getTime() + 7 * 24 * 60 * 60 * 1000)
  const mm = next.getUTCMonth() + 1
  const dd = next.getUTCDate()
  const days = ['일', '월', '화', '수', '목', '금', '토']
  const dow = days[next.getUTCDay()]
  return `${mm}월 ${dd}일(${dow}) 오전 7시`
}

// 어떤 날짜가 어느 호(주)에 속하는지 = 그 날짜가 포함된 주의 월요일
export function getWeekStartOf(ymd: string): string {
  const d = kstDateFromYMD(ymd)
  const dow = d.getUTCDay()
  const daysFromMonday = (dow + 6) % 7
  const monday = new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - daysFromMonday
  ))
  return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`
}

// 두 YMD 사이의 일수 차이 (b - a)
export function daysBetween(a: string, b: string): number {
  const da = kstDateFromYMD(a).getTime()
  const db = kstDateFromYMD(b).getTime()
  return Math.round((db - da) / (24 * 60 * 60 * 1000))
}
