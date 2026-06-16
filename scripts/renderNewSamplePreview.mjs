// 새 스타일 위클리 샘플을 HTML로 렌더링 (모바일 미리보기용)
// — 빌드된 dist를 사용하지 않고, src/templates/email.ts의 렌더링 로직을
//   런타임 JS로 재현하기 어려우므로, 실서버 admin 미리보기 엔드포인트 대신
//   /tmp의 본문 마크다운으로 직접 HTML을 만든다.

import fs from 'node:fs'
import path from 'node:path'

const md = fs.readFileSync('/tmp/new_sample_body.md', 'utf8')
const resp = JSON.parse(fs.readFileSync('/tmp/new_sample_response.json', 'utf8'))

// 매우 단순화한 미리보기용 HTML — 실제 email.ts와 동일한 시각 효과 재현
// (모바일 폭 375px 기준, 헤드라인 모음형 카드)

function escapeHtml(s) {
  if (!s) return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function splitSections(md) {
  const out = []
  let cur = null
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^##\s+(.+?)\s*$/)
    if (m) { if (cur) out.push(cur); cur = { heading: m[1].trim(), body: '' } }
    else if (cur) cur.body += line + '\n'
  }
  if (cur) out.push(cur)
  return out
}
function bullets(body) {
  return body.split(/\r?\n/).map(l => l.trim())
    .filter(l => /^[-•*]\s+/.test(l))
    .map(l => l.replace(/^[-•*]\s+/, '').replace(/\*\*/g, ''))
    .filter(Boolean)
}
function paragraphs(body) {
  return body.split(/\r?\n/).map(l => l.trim())
    .filter(l => l && !/^[-•*]\s+/.test(l) && !/^>/.test(l) && !/^예시[\s:]/i.test(l))
}

const sections = splitSections(md)

// 섹션 분류
const find = (re) => sections.find(s => re.test(s.heading))
const keywordSec = find(/keyword|키워드/i)
const onelineSec = find(/한\s*줄\s*정리|체크리스트/)
const onelinerSec = find(/시장\s*한\s*줄|^✍/)
const urbanSec = find(/도시정비|재개발|재건축/)
const saleSec = find(/분양|청약/)
const builderSec = find(/건설사|건설업계/)
const policySec = find(/정책|시장/)
const mediaSec = find(/광고|매체/)
const companySec = find(/GS|🔵|gs\s*위클리/i)
const insightSec = find(/인사이트|관점/)
const calendarSec = find(/캘린더|다음\s*주/)

// HTML 빌드
const kwTags = keywordSec ? bullets(keywordSec.body).map(b => {
  const t = b.replace(/^#+/, '').replace(/\s+/g, '')
  return t ? `#${t}` : null
}).filter(Boolean).slice(0, 8) : []

const kwHtml = kwTags.length ? `
  <div style="margin:0 0 22px;padding:18px 20px;background:#f8f4ff;border-radius:12px;">
    <div style="font-size:11px;font-weight:800;color:#5b21b6;letter-spacing:1.5px;margin-bottom:10px;">🔑 THIS WEEK KEYWORD</div>
    <div style="line-height:1.9;">
      ${kwTags.map(t => `<span style="display:inline-block;padding:6px 12px;margin:3px 4px 3px 0;background:#ede4fc;color:#5b21b6;font-size:13px;font-weight:700;border-radius:999px;line-height:1.4;">${escapeHtml(t)}</span>`).join('')}
    </div>
  </div>` : ''

const olBullets = onelineSec ? bullets(onelineSec.body) : []
const olHtml = olBullets.length ? `
  <div style="margin:0 0 22px;padding:18px 20px;background:#ecfdf5;border-left:5px solid #0f766e;border-radius:8px;">
    <div style="font-size:11px;font-weight:800;color:#0f766e;letter-spacing:1.5px;margin-bottom:10px;">✅ ONE-LINE BRIEF</div>
    <table cellpadding="0" cellspacing="0" border="0" width="100%">
      ${olBullets.map(b => `<tr><td style="vertical-align:top;width:24px;padding:4px 8px 4px 0;color:#0f766e;font-size:14px;font-weight:800;">✓</td><td style="vertical-align:top;padding:4px 0;font-size:14px;color:#0f3531;font-weight:600;line-height:1.55;">${escapeHtml(b)}</td></tr>`).join('')}
    </table>
  </div>` : ''

const oneliner = resp.market_oneliner || (onelinerSec ? paragraphs(onelinerSec.body)[0] : '')
const onelinerHtml = oneliner ? `
  <div style="margin:0 0 22px;padding:18px 20px;background:linear-gradient(135deg,#fef9e7 0%,#fef5d3 100%);border-left:5px solid #f0c14b;border-radius:8px;">
    <div style="font-size:11px;font-weight:800;color:#a67c00;letter-spacing:1.5px;margin-bottom:8px;">✍️ 이번 주 시장 한 줄</div>
    <div style="font-size:17px;font-weight:700;color:#2c3e50;line-height:1.55;">${escapeHtml(oneliner)}</div>
  </div>` : ''

const THEMES = {
  urban: { c: '#dc2626', lt: '#fee2e2' },
  sale: { c: '#2563eb', lt: '#dbeafe' },
  builder: { c: '#92400e', lt: '#fef3c7' },
  policy: { c: '#475569', lt: '#e2e8f0' },
  media: { c: '#be185d', lt: '#fce7f3' },
  company: { c: '#1e40af', lt: '#dbeafe' },
}

function headlineSec(sec, key, isMain = false, leadDefault = '') {
  if (!sec) return ''
  const bs = bullets(sec.body)
  if (bs.length === 0) return ''
  const ps = paragraphs(sec.body)
  const lead = ps[0] || leadDefault || `${bs.length}건 헤드라인`
  const th = THEMES[key]
  return `
    <div style="margin:0 0 26px;">
      <div style="font-size:18px;font-weight:800;color:#111827;margin-bottom:12px;padding-left:10px;border-left:4px solid ${th.c};">
        ${escapeHtml(sec.heading)}
        ${isMain ? '<span style="display:inline-block;padding:2px 8px;margin-left:8px;background:#dc2626;color:#fff;font-size:10px;font-weight:800;border-radius:4px;letter-spacing:1px;vertical-align:middle;">MAIN</span>' : ''}
        <span style="float:right;font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:0.5px;">${bs.length}건</span>
      </div>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 12px;background:${th.lt};border-left:4px solid ${th.c};border-radius:6px;">
        <tr><td style="padding:10px 14px;font-size:13px;color:${th.c};font-weight:700;line-height:1.55;">${escapeHtml(lead.length > 100 ? lead.slice(0, 97) + '...' : lead)}</td></tr>
      </table>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff;">
        ${bs.map(b => `<tr><td style="vertical-align:top;width:18px;padding:6px 6px 6px 0;color:${th.c};font-size:14px;font-weight:800;line-height:1.5;">•</td><td style="vertical-align:top;padding:6px 0;font-size:14px;color:#1f2937;font-weight:500;line-height:1.55;">${escapeHtml(b)}</td></tr>`).join('')}
      </table>
      <div style="margin-top:10px;text-align:right;">
        <a href="#" style="display:inline-block;font-size:12px;color:${th.c};text-decoration:none;font-weight:700;">👉 더 보기 →</a>
      </div>
    </div>`
}

const urbanHtml = headlineSec(urbanSec, 'urban', true)
const saleHtml = headlineSec(saleSec, 'sale')
const builderHtml = headlineSec(builderSec, 'builder')
const policyHtml = headlineSec(policySec, 'policy')
const mediaHtml = headlineSec(mediaSec, 'media')
const companyHtml = headlineSec(companySec, 'company')

const insightPara = insightSec ? paragraphs(insightSec.body) : []
const insightHtml = insightPara.length ? `
  <div style="margin:0 0 26px;padding:20px 22px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;">
    <div style="font-size:14px;font-weight:800;color:#92400e;letter-spacing:1px;margin-bottom:12px;">💡 모투스 인사이트</div>
    ${insightPara.slice(0, 6).map(p => `<div style="font-size:14px;color:#1f2937;line-height:1.75;margin:0 0 8px;">${escapeHtml(p)}</div>`).join('')}
  </div>` : ''

const calBullets = calendarSec ? bullets(calendarSec.body) : []
const calItems = calBullets.slice(0, 8).map(b => {
  const m = b.match(/^([0-9]{1,2}\/[0-9]{1,2}(?:\([^)]+\))?)\s*[—\-:·]\s*(.+)$/)
  return m ? { date: m[1], event: m[2] } : { date: '·', event: b }
})
const calHtml = calItems.length ? `
  <div style="margin:0 0 26px;">
    <div style="font-size:18px;font-weight:800;color:#111827;margin-bottom:12px;padding-left:10px;border-left:4px solid #0f766e;">
      📅 다음 주 캘린더
      <span style="float:right;font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:0.5px;">${calItems.length}건</span>
    </div>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-spacing:0;">
      ${calItems.map(it => `
        <tr>
          <td style="vertical-align:top;padding:10px 12px;background:#ecfdf5;border:1px solid #d1fae5;border-radius:8px;width:90px;text-align:center;">
            <div style="font-size:13px;font-weight:800;color:#0f766e;line-height:1.3;">${escapeHtml(it.date)}</div>
          </td>
          <td style="vertical-align:middle;padding:10px 14px;font-size:14px;color:#1f2937;font-weight:600;line-height:1.5;">${escapeHtml(it.event)}</td>
        </tr>
        <tr><td colspan="2" style="height:8px;line-height:8px;font-size:1px;">&nbsp;</td></tr>`).join('')}
    </table>
  </div>` : ''

// 최종 HTML
const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>모투스 위클리 VOL.020 (NEW STYLE) — 5/11~5/17</title>
<style>body{margin:0;padding:0;background:#f4f6f8;font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif;}</style>
</head>
<body>
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f6f8;padding:20px 0;">
<tr><td align="center">
<table cellpadding="0" cellspacing="0" border="0" width="375" style="max-width:375px;width:100%;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,0.06);">

  <!-- [1] 헤더 -->
  <tr><td style="background:linear-gradient(135deg,#1a2540 0%,#2c3e50 60%,#3498db 100%);padding:30px 26px;color:#fff;">
    <div style="font-size:13px;color:rgba(255,255,255,0.85);font-weight:600;letter-spacing:1.5px;">MOTUS WEEKLY</div>
    <div style="font-size:11px;letter-spacing:2px;color:rgba(255,255,255,0.75);font-weight:700;margin:6px 0 4px;">VOL.020 · 2026년 5월 2주차</div>
    <div style="font-size:22px;font-weight:800;line-height:1.3;margin-bottom:6px;">📬 모투스 위클리</div>
    <div style="font-size:12px;opacity:0.85;line-height:1.55;">5/11(월) ~ 5/17(일) · 481건 분석 · 30초 헤드라인 모음</div>
  </td></tr>

  <tr><td style="padding:24px 22px 18px;">
    ${kwHtml}
    ${olHtml}
    ${onelinerHtml}
    ${urbanHtml}
    ${saleHtml}
    ${builderHtml}
    ${policyHtml}
    ${mediaHtml}
    ${companyHtml}
    ${insightHtml}
    ${calHtml}

    <div style="text-align:center;margin:24px 0 6px;">
      <a href="#" style="display:inline-block;padding:13px 30px;background:#2c3e50;color:#fff;text-decoration:none;font-size:14px;border-radius:8px;font-weight:700;">웹에서 전체 호 보기 →</a>
    </div>
    <div style="margin:22px 0 4px;padding:12px 16px;background:#f8fafc;border-radius:8px;text-align:center;">
      <div style="font-size:10px;color:#7f8c8d;letter-spacing:1.5px;font-weight:700;margin-bottom:3px;">📬 NEXT ISSUE</div>
      <div style="font-size:13px;color:#2c3e50;font-weight:600;">2026년 5월 18일(월) 오전 7시</div>
    </div>
  </td></tr>

  <tr><td style="background:#1a2540;padding:22px 26px;color:#bdc3c7;font-size:11px;line-height:1.7;text-align:center;">
    <div style="font-weight:700;color:#fff;margin-bottom:5px;font-size:12px;letter-spacing:1.5px;">모투스 위클리</div>
    <div style="opacity:0.8;">매주 월요일 오전 7시, 모투스 리서치팀이 정리하는 30초 헤드라인 모음</div>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`

fs.writeFileSync('/tmp/new_sample_preview.html', html)
console.log('✓ Preview HTML written: /tmp/new_sample_preview.html')
console.log('  size:', html.length, 'bytes')
