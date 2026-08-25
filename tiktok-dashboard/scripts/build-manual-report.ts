// Builds the MANUAL-path report JSON (the skill's output format) from raw
// phase data, following prompts/SKILL-ruff-liners-euka-json-report.md
// (spec v3.1) — Phase 1 window rules, Phase 3 derived-value formulas, and the
// Phase 6 schema — implemented independently of src/lib/assembleReport.ts so
// scripts/parity-diff.ts is a real audit: if the skill spec and the pipeline
// code ever disagree on a formula, the diff fails.
//
// Usage: npx tsx scripts/build-manual-report.ts <phase-data.json> <today YYYY-MM-DD> [out.json]
import { readFileSync, writeFileSync } from 'fs'
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { validateGeneratedReport } from '../src/lib/validateReport'
import { PROMPT_VERSION } from '../src/lib/canonicalDefs'

const [phasePath, todayStr, outPath] = process.argv.slice(2)
if (!phasePath || !todayStr) {
  console.error('Usage: npx tsx scripts/build-manual-report.ts <phase-data.json> <today YYYY-MM-DD> [out.json]')
  process.exit(2)
}
const pd = JSON.parse(readFileSync(phasePath, 'utf-8'))

// ── Phase 1: date windows (skill rules) ─────────────────────────────────────
const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayStr)!
const TODAY = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
const GMV_END = subDays(TODAY, 2)
const GMV_START = subDays(GMV_END, 29)
const PRIOR_END = subDays(GMV_START, 1)
const PRIOR_START = subDays(PRIOR_END, 29)
const WEEK_END = GMV_END.getDay() === 6 ? GMV_END : subDays(GMV_END, GMV_END.getDay() + 1)
const WEEK_START = subDays(WEEK_END, 6)
const weeks = Array.from({ length: 13 }, (_, i) => subDays(WEEK_END, (12 - i) * 7)).map(e => ({ start: subDays(e, 6), end: e }))
const months = Array.from({ length: 6 }, (_, i) => {
  const d = subMonths(TODAY, 5 - i); const partial = i === 5
  return { label: format(d, 'MMM') + (partial ? '*' : ''), start: startOfMonth(d), end: partial ? TODAY : endOfMonth(d) }
})
const iso = (d: Date) => format(d, 'yyyy-MM-dd')

// ── Phase 3: derived values (skill formulas) ────────────────────────────────
const pct = (c: number, p: number) => (p ? Math.round(((c - p) / p) * 1000) / 10 : null)
const round1 = (v: any) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 10) / 10 : undefined }
const a1 = pd.A1 || {}, a2 = pd.A2 || {}, a3 = pd.A3 || {}, a4 = pd.A4 || { total: {} }, a5 = pd.A5 || { total: {} }, a6 = pd.A6 || {}
const LVLS = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'] as const
const c1 = pd.C1 || [], c3 = pd.C3 || [], c4 = pd.C4 || [], c5 = pd.C5 || {}
const d1 = pd.D1 || [], d3 = pd.D3 || [], d4 = pd.D4 || {}
const c2p = pd.C2P || {}, c2v = pd.C2V || {}, d2p = pd.D2P || {}, d2v = pd.D2V || {}
const series = (src: any, field: string) => Object.fromEntries(LVLS.map(lk => [
  `${field === 'creators' ? 'crl' : field === 'newCreators' ? 'ncl' : field === 'videos' ? 'vl' : field === 'gmv' ? 'gl' : field === 'views' ? 'vwl' : field === 'msgs' ? 'ml' : field === 'samples' ? 'sl' : 'sal'}${lk[1]}`,
  (src[lk] || []).map((r: any) => r[field === 'approved' ? 'approved' : field] || 0)
]))
const ret1 = (rows: any[]) => rows.map((v: any) => Math.round((Number(v) || 0) * 10) / 10)

const report: any = {
  meta: {
    reportDate: iso(TODAY),
    label: format(TODAY, 'MMMM d, yyyy'),
    dataWindow: `${format(GMV_START, 'MMM d')} – ${format(GMV_END, 'MMM d, yyyy')}`,
    promptVersion: PROMPT_VERSION,
    weekWindow: { start: iso(WEEK_START), end: iso(WEEK_END) },
    d30Window: { start: iso(GMV_START), end: iso(GMV_END) },
    priorWindow: { start: iso(PRIOR_START), end: iso(PRIOR_END) },
    timezone: 'America/Los_Angeles',
    generatedAt: new Date().toISOString()
  },
  d30: {
    gmv: a1.gmv || 0, gmvPct: pct(a1.gmv || 0, a2.gmv || 0),
    shopGmv: a1.shopGmv || undefined, shopGmvPct: a1.shopGmv ? round1(a1.shopGmvPct) : undefined,
    affiliateGmv: a1.affiliateGmv || undefined, affiliateGmvPct: a1.affiliateGmv ? round1(a1.affiliateGmvPct) : undefined,
    orders: a1.orders || 0, ordersPct: pct(a1.orders || 0, a2.orders || 0),
    videos: a1.videos || 0, videosPct: pct(a1.videos || 0, a2.videos || 0),
    views: a1.views || 0, viewsPct: pct(a1.views || 0, a2.views || 0),
    creators: a1.creators || 0, creatorsPct: pct(a1.creators || 0, a2.creators || 0),
    newCreators: a1.newCreators || 0, newCreatorsPct: pct(a1.newCreators || 0, a2.newCreators || 0),
    retention: a1.retention || 0,
    retentionDelta: Math.round(((a1.retention || 0) - (a2.retention || 0)) * 10) / 10,
    gmvMax: { spend: a6.spend || 0, revenue: a6.revenue || 0, roi: a6.roi || 0 },
    gmvMaxByAge: pd.A7 && pd.A7.length ? pd.A7 : undefined,
    msgs: a4.total?.msgs || 0, msgsPct: pct(a4.total?.msgs || 0, a5.total?.msgs || 0),
    samples: a4.total?.samples || 0, samplesPct: pct(a4.total?.samples || 0, a5.total?.samples || 0),
    tiers: Object.fromEntries(LVLS.map(lk => [lk, {
      creators: a3[lk]?.creators || 0, newCreators: a3[lk]?.newCreators || 0,
      videos: a3[lk]?.videos || 0, views: a3[lk]?.views || 0, gmv: a3[lk]?.gmv || 0,
      gmvMaxSpend: a6[lk]?.spend || 0, gmvMaxRoi: a6[lk]?.roi || 0,
      msgs: a4[lk]?.msgs || 0, msgsPct: pct(a4[lk]?.msgs || 0, a5[lk]?.msgs || 0),
      samples: a4[lk]?.samples || 0, samplesPct: pct(a4[lk]?.samples || 0, a5[lk]?.samples || 0)
    }]))
  },
  weeklyCharts: {
    labels: weeks.map(w => `${w.start.getMonth() + 1}/${w.start.getDate()}`),
    gmv: c1.map((r: any) => r.gmv || 0), views: c4.map((r: any) => r.views || 0),
    ...series(c2p, 'creators'), ...series(c2p, 'newCreators'), ...series(c2p, 'videos'),
    ...series(c2v, 'gmv'), ...series(c2v, 'views'),
    ret: ret1(c3), vid: c4.map((r: any) => r.videos || 0),
    ...series(c5, 'msgs'), ...series(c5, 'samples')
  },
  monthlyCharts: {
    labels: months.map(mo => mo.label),
    gmv: d1.map((r: any) => r.gmv || 0),
    shopGmv: d1.map((r: any) => r.shopGmv || 0),
    affiliateGmv: d1.map((r: any) => r.gmv || 0),
    views: d1.map((r: any) => r.views || 0),
    ...series(d2p, 'creators'), ...series(d2p, 'newCreators'), ...series(d2p, 'videos'),
    ...series(d2v, 'gmv'), ...series(d2v, 'views'),
    ret: ret1(d3),
    ...series(d4, 'msgs'), ...series(d4, 'samples'), ...series(d4, 'approved')
  },
  tables: {
    topCreators: pd.topCreators || [], topVideos: pd.topVideos || [], activeCreators: pd.activeCreators || [],
    weeklyTopCreators: pd.weeklyTopCreators || [], weeklyTopVideos: pd.weeklyTopVideos || [], weeklyActiveCreators: pd.weeklyActiveCreators || []
  },
  agents: pd.agents || [],
  analysis: {
    performance: pd.performance || '', creators: pd.creators || '',
    recruiting: pd.recruiting || '', growth: pd.growth || ''
  },
  validation: { passed: true, flags: [] }
}

// ── Phase 4: self-validation (V1–V13 via the shared gate, V14/V15 here) ────
const issues = validateGeneratedReport({
  d30: report.d30, weekly_charts: report.weeklyCharts,
  monthly_charts: report.monthlyCharts, tables: report.tables
})
const tierGmvSum = LVLS.reduce((a, k) => a + (Number(report.d30.tiers[k].gmv) || 0), 0)
if (Math.abs(tierGmvSum - report.d30.gmv) > 1) {
  issues.push(`V14: tier GMV sums to ${tierGmvSum} but d30.gmv is ${report.d30.gmv} — must match within $1`)
}
const roundHits: string[] = []
for (const [tName, rows] of Object.entries(report.tables)) {
  for (const row of rows as any[]) {
    for (const f of ['sgmv', 'ggmv', 'gmv', 'gmvN', 'gmvT']) {
      const v = Number(row[f])
      if (Number.isFinite(v) && v >= 10000 && v % 10000 === 0) roundHits.push(`${tName}.${f} ${row.h}=$${v}`)
    }
  }
}
if (roundHits.length) issues.push(`V15 spot-check (round multiples of $10,000, verify against source): ${roundHits.join('; ')}`)
report.validation = { passed: issues.length === 0, flags: issues }

const out = outPath || 'manual-report.json'
writeFileSync(out, JSON.stringify(report, null, 2))
console.log(`wrote ${out} — validation.passed=${report.validation.passed}${issues.length ? '\nflags:\n  ' + issues.join('\n  ') : ''}`)
