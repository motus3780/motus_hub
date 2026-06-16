#!/usr/bin/env node
// 5/11(또는 임의 날짜) 수집 뉴스 데이터로
// "일반본 위클리"와 "GS건설 맞춤 위클리"의 입력 데이터 차이를 비교.
//
// 비교 항목:
//   - 점수 기반 상위 30건 (일반 = 알고리즘 점수 미적용 → 단순 발행일 정렬, GS = 점수 정렬)
//   - 카테고리별 분포 변화
//   - 새로 포함된 기사 / 순위 상승 기사 / 노출 우선순위 변동
//
// LLM 호출 없이 입력 데이터의 차이만 분석 — Claude API 키 미설정 환경에서 동작.
//
// 사용법:
//   node scripts/simulateGsWeekly.mjs              # 가장 최근 일자
//   node scripts/simulateGsWeekly.mjs 2026-05-11   # 특정 일자

import { execSync } from 'node:child_process'
import fs from 'node:fs'

// ── GS 프로필 (companyProfiles.ts와 동일) ──────────────────────────────
const GS = {
  displayName: 'GS건설',
  focusKeywords: ['GS건설','지에스건설','자이','Xi','Self','자이에스앤디','GS이앤알','GS이앤씨','GS E&C','허윤홍','GS건설 대표','자이르네','자이아파트'],
  competitorKeywords: ['현대건설','힐스테이트','디에이치','THE H','삼성물산','삼성물산 건설부문','래미안','RAEMIAN','대우건설','푸르지오','써밋','SUMMIT','DL이앤씨','DL E&C','e편한세상','아크로','ACRO','포스코이앤씨','POSCO E&C','더샵','THE SHARP','롯데건설','롯데캐슬','LOTTE Castle','SK에코플랜트','SK뷰','SK VIEW','HDC현대산업개발','아이파크','IPARK','현대엔지니어링','HillState','한화건설','꿈에그린','포레나'],
  watchRegions: ['압구정','반포','잠실','도곡','개포','대치','청담','삼성','서초','한남','여의도','성수','용산','이촌','상계','목동','신정','둔촌','명일','분당','일산','평촌','중동','산본','해운대','수영구'],
}
const PRIME = ['강남','강남구','서초','서초구','송파','용산','여의도','한강','압구정','반포','한남']
const CONTRACTOR_KW = ['시공사 선정','시공사선정','수주','입찰','컨소시엄','재입찰','우선협상','본계약','시공권']
const PRESALE_KW = ['분양','청약','계약금','중도금','입주자모집공고','특별공급']
const DISTRICT_RE = /[가-힣A-Za-z0-9]+(?:\d+)?\s*(?:구역|정비구역|재개발|재건축|뉴타운|모아타운)/

function scoreArticle(a) {
  const text = `${a.title || ''} ${(a.description || '').slice(0, 300)}`
  const focusMatched = GS.focusKeywords.filter(k => text.includes(k))
  const competitorMatched = GS.competitorKeywords.filter(k => text.includes(k))
  const regionMatched = GS.watchRegions.filter(r => text.includes(r))
  const primeMatched = PRIME.filter(h => text.includes(h))
  const contractor = CONTRACTOR_KW.some(k => text.includes(k))
  const district = DISTRICT_RE.test(text)
  const presale = PRESALE_KW.some(k => text.includes(k))

  let total = 100
  const breakdown = { base: 100 }
  if (focusMatched.length > 0) { total += 50; breakdown.focus = 50 }
  if (competitorMatched.length > 0) { total += 20; breakdown.competitor = 20 }
  if (regionMatched.length > 0) { total += 30; breakdown.region = 30 }
  if (primeMatched.length > 0) { total += 20; breakdown.primeRegion = 20 }
  if (contractor) { total += 25; breakdown.contractor = 25 }
  if (district) { total += 15; breakdown.district = 15 }
  if (presale && focusMatched.length > 0) { total += 30; breakdown.selfPresale = 30 }
  else if (presale && primeMatched.length > 0) { total += 15; breakdown.primePresale = 15 }
  return { total, breakdown, matched: { focus: focusMatched, competitor: competitorMatched, region: regionMatched } }
}

// ── DB 조회 ──────────────────────────────────────────────────────────────
const targetDate = process.argv[2] || null
const where = targetDate ? `WHERE collection_date = '${targetDate}'` : `WHERE collection_date = (SELECT MAX(collection_date) FROM news)`
const sql = `SELECT id, title, description, link, source, pub_date, category, collection_date FROM news ${where}`
console.log(`[sim] 조회 SQL: ${sql.slice(0, 120)}...`)

const out = execSync(
  `cd /home/user/webapp && npx wrangler d1 execute webapp-production --local --command="${sql.replace(/"/g, '\\"')}" --json`,
  { maxBuffer: 64 * 1024 * 1024 }
).toString()
const rows = JSON.parse(out.match(/\[[\s\S]*\]/)[0])[0].results || []
console.log(`[sim] 조회 결과: ${rows.length}건`)
if (rows.length === 0) {
  console.error('데이터 없음 — 다른 날짜 시도 필요')
  process.exit(1)
}
const collectionDate = rows[0].collection_date
console.log(`[sim] 대상 일자: ${collectionDate}`)

// ── 점수 적용 ──────────────────────────────────────────────────────────────
const scored = rows.map(r => ({ ...r, _score: scoreArticle(r) }))

// 일반본 정렬: pub_date 내림차순 (또는 id 내림차순) — "최신순" 가정
const generalSorted = [...scored].sort((a, b) => {
  const ad = a.pub_date || a.collection_date
  const bd = b.pub_date || b.collection_date
  return String(bd).localeCompare(String(ad)) || (b.id - a.id)
})
// GS 정렬: 점수 내림차순 → 동률 시 pub_date
const gsSorted = [...scored].sort((a, b) => {
  if (b._score.total !== a._score.total) return b._score.total - a._score.total
  return String(b.pub_date || '').localeCompare(String(a.pub_date || ''))
})

// ── 상위 N건 비교 ──────────────────────────────────────────────────────────
const TOP = 30
const generalTop = generalSorted.slice(0, TOP)
const gsTop = gsSorted.slice(0, TOP)
const generalTopIds = new Set(generalTop.map(r => r.id))
const gsTopIds = new Set(gsTop.map(r => r.id))

const addedByGs = gsTop.filter(r => !generalTopIds.has(r.id))
const removedFromGeneral = generalTop.filter(r => !gsTopIds.has(r.id))
const inBoth = gsTop.filter(r => generalTopIds.has(r.id))

console.log(`\n=== 상위 ${TOP}건 비교 (대상 일자: ${collectionDate}, 전체 ${rows.length}건) ===`)
console.log(`공통: ${inBoth.length}건`)
console.log(`GS 버전에 새로 추가: ${addedByGs.length}건`)
console.log(`GS 버전에서 빠짐: ${removedFromGeneral.length}건`)

// ── 카테고리별 분포 ──────────────────────────────────────────────────────
function dist(arr) {
  const d = {}
  for (const r of arr) d[r.category] = (d[r.category] || 0) + 1
  return d
}
const generalDist = dist(generalTop)
const gsDist = dist(gsTop)
const allCats = new Set([...Object.keys(generalDist), ...Object.keys(gsDist)])
console.log(`\n── 카테고리별 상위 ${TOP}건 분포 ──`)
console.log(`${'카테고리'.padEnd(14)} ${'일반'.padStart(5)}  ${'GS'.padStart(5)}  변화`)
for (const c of Array.from(allCats).sort()) {
  const g = generalDist[c] || 0
  const gs = gsDist[c] || 0
  const diff = gs - g
  const sign = diff > 0 ? `+${diff}` : (diff < 0 ? String(diff) : '')
  console.log(`${c.padEnd(14)} ${String(g).padStart(5)}  ${String(gs).padStart(5)}  ${sign}`)
}

// ── 추가된 기사 상세 ──
console.log(`\n── GS 버전에 새로 추가된 기사 (상위 ${TOP} 진입) ──`)
addedByGs.slice(0, 15).forEach((r, i) => {
  const m = r._score.matched
  const why = [
    m.focus.length ? `자사:${m.focus.slice(0,3).join('/')}` : '',
    m.competitor.length ? `경쟁사:${m.competitor.slice(0,2).join('/')}` : '',
    m.region.length ? `구역:${m.region.slice(0,2).join('/')}` : '',
  ].filter(Boolean).join(' / ')
  console.log(`  ${(i + 1).toString().padStart(2)}. [${r.category}] (점수 ${r._score.total}) ${r.title.slice(0, 60)}`)
  if (why) console.log(`        └─ ${why}`)
})

// ── GS 상위 10건 ──
console.log(`\n── GS 버전 TOP 10 (점수순) ──`)
gsTop.slice(0, 10).forEach((r, i) => {
  const m = r._score.matched
  const tag = m.focus.length > 0 ? '🔵 자사' : (m.competitor.length > 0 ? '🟡 경쟁사' : (m.region.length > 0 ? '🟢 관심지' : '⚪ 일반'))
  console.log(`  ${(i + 1).toString().padStart(2)}. [${r._score.total}점] ${tag} [${r.category}] ${r.title.slice(0, 55)}`)
})

// ── 일반 상위 10건 (비교용) ──
console.log(`\n── 일반 버전 TOP 10 (최신순) ──`)
generalTop.slice(0, 10).forEach((r, i) => {
  console.log(`  ${(i + 1).toString().padStart(2)}. [${r.category}] ${r.title.slice(0, 65)}`)
})

// ── GS 키워드 매칭 통계 ──
const focusHits = scored.filter(r => r._score.matched.focus.length > 0)
const competitorHits = scored.filter(r => r._score.matched.competitor.length > 0)
const regionHits = scored.filter(r => r._score.matched.region.length > 0)

console.log(`\n── 키워드 매칭 통계 (전체 ${rows.length}건 기준) ──`)
console.log(`  GS건설/자이 자사 키워드 매칭:    ${focusHits.length}건 (${(focusHits.length / rows.length * 100).toFixed(1)}%)`)
console.log(`  주요 경쟁사 키워드 매칭:         ${competitorHits.length}건 (${(competitorHits.length / rows.length * 100).toFixed(1)}%)`)
console.log(`  관심 정비구역 매칭:              ${regionHits.length}건 (${(regionHits.length / rows.length * 100).toFixed(1)}%)`)

// ── 결과 파일 저장 ──
const outPath = '/tmp/gs_weekly_simulation.json'
fs.writeFileSync(outPath, JSON.stringify({
  collection_date: collectionDate,
  total_articles: rows.length,
  comparison: {
    common_count: inBoth.length,
    added_by_gs: addedByGs.length,
    removed_from_general: removedFromGeneral.length,
  },
  category_distribution: { general: generalDist, gs: gsDist },
  general_top_30: generalTop.map(r => ({ id: r.id, category: r.category, title: r.title, source: r.source })),
  gs_top_30: gsTop.map(r => ({
    id: r.id, category: r.category, title: r.title, source: r.source,
    score: r._score.total, matched: r._score.matched,
  })),
  added_by_gs_full: addedByGs.map(r => ({
    id: r.id, category: r.category, title: r.title, source: r.source,
    score: r._score.total, matched: r._score.matched,
  })),
  keyword_stats: {
    focus_hits: focusHits.length,
    competitor_hits: competitorHits.length,
    region_hits: regionHits.length,
  },
}, null, 2))
console.log(`\n[sim] 상세 결과 저장: ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`)
