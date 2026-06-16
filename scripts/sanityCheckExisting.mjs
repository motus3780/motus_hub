#!/usr/bin/env node
// 기존 DB에 저장된 일간 요약(summaries.content)에 대해 sanityCheckSummary를 실행.
// 새 필터 도입 전/후의 차이를 정량적으로 비교하기 위함.

import { execSync } from 'node:child_process'

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
  '홍준표','오세훈','김동연','박형준','윤석열','한덕수','김부겸',
]
const AD_MEDIA_TERMS = ['OTT','유튜브','틱톡','디지털사이니지','옥외광고']

const out = execSync(
  `cd /home/user/webapp && npx wrangler d1 execute webapp-production --local --command="SELECT summary_date, article_count, content FROM summaries ORDER BY summary_date DESC" --json`,
  { maxBuffer: 64 * 1024 * 1024 }
).toString()
const rows = JSON.parse(out.match(/\[[\s\S]*\]/)[0])[0].results

console.log(`기존 요약 ${rows.length}건 sanityCheck 실시\n`)
console.log(`${'날짜'.padEnd(12)} ${'기사수'.padStart(5)} ${'정치KW'.padStart(7)} ${'정치인'.padStart(7)} ${'광고매체'.padStart(8)}  매칭 상세`)
console.log('─'.repeat(110))

for (const r of rows) {
  const text = r.content || ''
  const kw = POLITICS_KEYWORDS.filter(k => text.includes(k))
  const pol = POLITICIAN_NAMES.filter(n => text.includes(n))
  const adm = AD_MEDIA_TERMS.filter(t => text.includes(t))
  const detail = [
    kw.length ? `KW[${kw.join(',')}]` : '',
    pol.length ? `POL[${pol.join(',')}]` : '',
    adm.length ? `AD[${adm.join(',')}]` : '',
  ].filter(Boolean).join(' ') || '✅ 통과'
  console.log(`${r.summary_date.padEnd(12)} ${String(r.article_count).padStart(5)} ${String(kw.length).padStart(7)} ${String(pol.length).padStart(7)} ${String(adm.length).padStart(8)}  ${detail}`)
}
