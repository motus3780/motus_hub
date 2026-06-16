#!/usr/bin/env node
// 지난 1주일치 news 테이블에 새 politicsFilter를 소급 적용하여
// 어떤 기사가 제외되는지 시뮬레이션하는 dry-run 스크립트.
//
// 사용법:
//   node scripts/retroactiveFilter.mjs              # 전체 news 테이블 대상
//   node scripts/retroactiveFilter.mjs 2026-05-05   # 특정 날짜 이후만
//
// 출력:
//   - 콘솔: 카테고리별 제외 통계, 키워드 매칭 Top 20, 정치인 매칭 Top 20
//   - /tmp/retroactive_excluded.json : 제외 후보 기사 전체 리스트 (감사용)
//
// ※ DB는 수정하지 않음(read-only dry-run).

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// ── politicsFilter.ts와 동일한 로직을 그대로 복사 ──────────────────────────
const POLITICS_KEYWORDS = [
  '지방선거','총선','재보선','재보궐','보궐선거','대선','대통령선거',
  '후보','공약','유세','지원유세','당선','낙선','출마','경선',
  '당대표','원내대표','비대위','비상대책위','최고위',
  '민주당','국민의힘','조국혁신당','진보당','개혁신당',
  '정의당','기본소득당','사회민주당',
  '대통령실','청와대','탄핵','여야','여야정','야권','여권',
  '의원실','국회의원','의원단','원내','정쟁',
]
const POLITICIAN_NAMES = [
  '이재명','한동훈','조국','이준석','이낙연','안철수',
  '홍준표','오세훈','김동연','박형준',
  '윤석열','한덕수','김부겸',
]
const POLITICS_URL_PATTERNS = [
  /\/politics\//i,/\/political\//i,/\/opinion\//i,/\/opinions\//i,
  /\/editorial\//i,/\/column\//i,/\/columns\//i,/\/series\/column\//i,
  /\/election\//i,/\/vote\//i,
]
const GOV_AGENCY_WHITELIST = [
  '국토교통부','국토부','기획재정부','기재부','금융위원회','금융위',
  '금융감독원','금감원','한국은행','한은','주택도시보증공사','HUG',
  '한국주택금융공사','HF','한국부동산원','한국토지주택공사','LH',
  '서울주택도시공사','SH','경기주택도시공사','GH',
  '공정거래위원회','공정위','통계청','국세청',
]
const HARD_POLITICAL = new Set([
  '후보','공약','유세','지원유세','당선','낙선','출마','경선',
  '탄핵','비대위','비상대책위','대선','대통령선거','총선',
  '지방선거','재보선','재보궐','보궐선거',
])

function findKeywordsIn(text, list) {
  if (!text) return []
  return list.filter(k => text.includes(k))
}
function checkPolitics({ title, description, link }) {
  const t = title || ''
  const bodyHead = (description || '').slice(0, 200)
  const combined = `${t} ${bodyHead}`

  const matchedKeywords = findKeywordsIn(combined, POLITICS_KEYWORDS)
  const politiciansInTitleHead = POLITICIAN_NAMES.filter(n => t.slice(0, 30).includes(n))
  const politiciansInScope = POLITICIAN_NAMES.filter(n => combined.includes(n))
  const matchedPoliticians = Array.from(new Set([...politiciansInTitleHead, ...politiciansInScope]))
  const matchedUrls = POLITICS_URL_PATTERNS.filter(re => re.test(link || '')).map(re => re.source)
  const whitelistHits = findKeywordsIn(combined, GOV_AGENCY_WHITELIST)

  // 1) URL
  if (matchedUrls.length > 0) {
    return { isPolitical: true, reason: `URL 패턴: ${matchedUrls.join(', ')}`,
             matched: { keywords: matchedKeywords, politicians: matchedPoliticians, urlPatterns: matchedUrls } }
  }
  // 2) 제목 첫 30자 정치인
  if (politiciansInTitleHead.length > 0) {
    return { isPolitical: true, reason: `제목 정치인: ${politiciansInTitleHead.join(', ')}`,
             matched: { keywords: matchedKeywords, politicians: matchedPoliticians, urlPatterns: matchedUrls } }
  }
  // 2-b) 본문 정치인
  const bodyOnlyPoliticians = politiciansInScope.filter(n => !politiciansInTitleHead.includes(n))
  if (bodyOnlyPoliticians.length > 0) {
    return { isPolitical: true, reason: `본문 정치인 인용: ${bodyOnlyPoliticians.join(', ')}`,
             matched: { keywords: matchedKeywords, politicians: matchedPoliticians, urlPatterns: matchedUrls } }
  }
  // 3) 키워드
  if (matchedKeywords.length > 0) {
    if (whitelistHits.length > 0) {
      const hard = matchedKeywords.filter(k => HARD_POLITICAL.has(k))
      if (hard.length > 0) {
        return { isPolitical: true, reason: `WL 무력화(${hard.join(',')}) + WL(${whitelistHits.join(',')})`,
                 matched: { keywords: matchedKeywords, politicians: matchedPoliticians, urlPatterns: matchedUrls } }
      }
      return { isPolitical: false, reason: `WL 통과(${whitelistHits.join(',')})`,
               matched: { keywords: matchedKeywords, politicians: matchedPoliticians, urlPatterns: matchedUrls } }
    }
    return { isPolitical: true, reason: `정치 키워드: ${matchedKeywords.join(', ')}`,
             matched: { keywords: matchedKeywords, politicians: matchedPoliticians, urlPatterns: matchedUrls } }
  }
  return { isPolitical: false, reason: '-', matched: { keywords: [], politicians: [], urlPatterns: [] } }
}

// ── D1 조회 ──────────────────────────────────────────────────────────────
const sinceDate = process.argv[2] || null
const where = sinceDate ? `WHERE collection_date >= '${sinceDate}'` : ''
const sql = `SELECT id, title, description, link, source, pub_date, category, collection_date FROM news ${where} ORDER BY collection_date DESC, id DESC`

console.log(`[retroactive] D1 조회 시작 (조건: ${sinceDate ? `>=${sinceDate}` : '전체'})`)
let rows = []
try {
  const out = execSync(
    `cd /home/user/webapp && npx wrangler d1 execute webapp-production --local --command="${sql.replace(/"/g, '\\"')}" --json`,
    { maxBuffer: 64 * 1024 * 1024 }
  ).toString()
  // wrangler JSON 출력 파싱
  const m = out.match(/\[[\s\S]*\]/)
  if (!m) throw new Error('JSON 블록을 찾을 수 없음')
  const parsed = JSON.parse(m[0])
  rows = parsed[0]?.results || []
} catch (e) {
  console.error('[retroactive] D1 조회 실패:', e.message)
  process.exit(1)
}
console.log(`[retroactive] 조회된 기사 수: ${rows.length}`)

// ── 시뮬레이션 ────────────────────────────────────────────────────────────
const excluded = []
const kept = []
const byCategoryExcluded = {}
const byCategoryKept = {}
const keywordCount = {}
const politicianCount = {}
const urlPatternCount = {}

for (const r of rows) {
  const result = checkPolitics({ title: r.title, description: r.description, link: r.link })
  byCategoryExcluded[r.category] ??= 0
  byCategoryKept[r.category] ??= 0
  if (result.isPolitical) {
    excluded.push({ ...r, exclusion: result })
    byCategoryExcluded[r.category]++
    for (const k of result.matched.keywords) keywordCount[k] = (keywordCount[k] || 0) + 1
    for (const p of result.matched.politicians) politicianCount[p] = (politicianCount[p] || 0) + 1
    for (const u of result.matched.urlPatterns) urlPatternCount[u] = (urlPatternCount[u] || 0) + 1
  } else {
    kept.push(r)
    byCategoryKept[r.category]++
  }
}

// ── 출력 ──────────────────────────────────────────────────────────────────
const total = rows.length
const excCount = excluded.length
const ratio = total > 0 ? (excCount / total * 100).toFixed(2) : '0.00'

console.log('\n=== 소급 적용 결과 ===')
console.log(`총 ${total}건 중 ${excCount}건 제외 (${ratio}%)`)
console.log(`보존: ${kept.length}건`)

console.log('\n── 카테고리별 ──')
const cats = Array.from(new Set([...Object.keys(byCategoryExcluded), ...Object.keys(byCategoryKept)])).sort()
console.log(`${'카테고리'.padEnd(20)} ${'제외'.padStart(6)} ${'보존'.padStart(6)} ${'제외율'.padStart(8)}`)
for (const c of cats) {
  const e = byCategoryExcluded[c] || 0
  const k = byCategoryKept[c] || 0
  const r = (e + k) > 0 ? (e / (e + k) * 100).toFixed(1) + '%' : '-'
  console.log(`${c.padEnd(20)} ${String(e).padStart(6)} ${String(k).padStart(6)} ${r.padStart(8)}`)
}

const topN = (obj, n = 20) =>
  Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)

console.log('\n── 매칭 키워드 Top 20 ──')
for (const [k, v] of topN(keywordCount, 20)) console.log(`  ${k.padEnd(10)} ${v}`)

console.log('\n── 매칭 정치인 Top 20 ──')
for (const [k, v] of topN(politicianCount, 20)) console.log(`  ${k.padEnd(10)} ${v}`)

console.log('\n── 매칭 URL 패턴 ──')
for (const [k, v] of topN(urlPatternCount, 10)) console.log(`  ${k.padEnd(30)} ${v}`)

// ── 제외 후보 샘플 출력 ──
console.log('\n── 제외 후보 샘플 (최대 30건) ──')
for (const e of excluded.slice(0, 30)) {
  console.log(`  [${e.collection_date}] [${e.category}] ${e.title}`)
  console.log(`      └─ ${e.exclusion.reason}`)
}

// ── 파일 출력 ──
const outPath = '/tmp/retroactive_excluded.json'
fs.writeFileSync(outPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  since_date: sinceDate,
  summary: {
    total,
    excluded: excCount,
    kept: kept.length,
    ratio_percent: parseFloat(ratio),
    by_category_excluded: byCategoryExcluded,
    by_category_kept: byCategoryKept,
    top_keywords: topN(keywordCount, 30),
    top_politicians: topN(politicianCount, 30),
    top_url_patterns: topN(urlPatternCount, 20),
  },
  excluded_articles: excluded,
}, null, 2))
console.log(`\n[retroactive] 상세 결과 저장: ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`)
