// Strict post-generation gate for AUTO-GENERATED reports. Stricter than the
// dashboard's reconcileD30 banner (which stays as the last-resort display for
// manually pasted reports and live snapshots): a generated report that fails
// these checks is re-pulled and, after 2 failed retries, rejected outright —
// never saved with a warning banner. Thresholds mirror the canonical metric
// definitions in lib/canonicalDefs.ts.
const LVLS = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'] as const

const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

// |a-b| within pct% of the larger magnitude; two zeros always pass
function within(a: number, b: number, pct: number): boolean {
  const base = Math.max(Math.abs(a), Math.abs(b))
  if (base === 0) return true
  return (Math.abs(a - b) / base) * 100 <= pct
}

const f = (v: number) => Math.round(v).toLocaleString('en-US')

export function validateGeneratedReport(report: any): string[] {
  const issues: string[] = []
  const d = report?.d30 ?? {}
  const tiers = d.tiers ?? {}
  const tierSum = (field: string) => LVLS.reduce((a, k) => a + n(tiers[k]?.[field]), 0)

  // Tier breakdowns vs headline totals — GMV/views within 1%, counts exact
  if (!within(tierSum('gmv'), n(d.gmv), 1)) {
    issues.push(`tier GMV: L1..L7 sum to ${f(tierSum('gmv'))} but d30.gmv is ${f(n(d.gmv))} — must match within 1% (tier GMV includes evergreen-video GMV)`)
  }
  if (!within(tierSum('views'), n(d.views), 1)) {
    issues.push(`tier views: L1..L7 sum to ${f(tierSum('views'))} but d30.views is ${f(n(d.views))} — must match within 1% (views = SUM(impressions))`)
  }
  for (const field of ['creators', 'videos', 'newCreators'] as const) {
    if (tierSum(field) !== n(d[field])) {
      issues.push(`tier ${field}: L1..L7 sum to ${f(tierSum(field))} but d30.${field} is ${f(n(d[field]))} — must match exactly (dedup by handle)`)
    }
  }

  // GMV Max header must come from the same source as the age buckets
  const buckets: any[] = Array.isArray(d.gmvMaxByAge) ? d.gmvMaxByAge : []
  if (buckets.length) {
    const bucketSpend = buckets.reduce((a, b) => a + n(b?.spend), 0)
    if (!within(n(d.gmvMax?.spend), bucketSpend, 1)) {
      issues.push(`GMV Max spend: header is ${f(n(d.gmvMax?.spend))} but age buckets sum to ${f(bucketSpend)} — must match within 1% (header comes from the GMV Max ad tables, not totalAdSpend)`)
    }
  }

  // Weekly per-tier series must sum to each week's totals (±1%)
  const wc = report?.weekly_charts ?? {}
  const weekly = (prefix: string, totals: unknown[], label: string) => {
    const bad: number[] = []
    ;(totals ?? []).forEach((total, i) => {
      const s = LVLS.reduce((a, k) => a + n((wc[`${prefix}${k[1]}`] ?? [])[i]), 0)
      if (!within(s, n(total), 1)) bad.push(i + 1)
    })
    if (bad.length) {
      issues.push(`weekly ${label}: per-tier ${prefix}1..${prefix}7 do not sum to the week total (±1%) for week(s) ${bad.join(', ')} of ${(totals ?? []).length}`)
    }
  }
  weekly('gl', wc.gmv ?? [], 'GMV')
  weekly('vwl', wc.views ?? [], 'views')

  // Structural checks — a series with the wrong number of buckets or a
  // negative value means the extraction misread the window spec, not that
  // the store had a bad week. Issues are prefixed "series <chart>.<key>:"
  // so phasesForIssue can route the retry to the phase that pulled them.
  const mc = report?.monthly_charts ?? {}
  const nWeeks = Array.isArray(wc.labels) ? wc.labels.length : 13
  const nMonths = Array.isArray(mc.labels) ? mc.labels.length : 6
  const series = (chart: any, chartName: string, key: string, expected: number) => {
    const arr = chart?.[key]
    if (!Array.isArray(arr)) return
    if (arr.length !== expected) {
      issues.push(`series ${chartName}.${key}: has ${arr.length} items but the window has ${expected} — return one item per bucket in chronological order`)
    }
    if (arr.some((v: unknown) => Number.isFinite(Number(v)) && Number(v) < 0)) {
      issues.push(`series ${chartName}.${key}: contains a negative value — re-pull, these metrics are never negative`)
    }
  }
  const perLevel = (prefix: string) => LVLS.map(k => `${prefix}${k[1]}`)
  for (const key of ['gmv', 'views', 'ret', 'vid',
    ...perLevel('crl'), ...perLevel('ncl'), ...perLevel('vl'),
    ...perLevel('gl'), ...perLevel('vwl'), ...perLevel('ml'), ...perLevel('sl')]) {
    series(wc, 'weekly_charts', key, nWeeks)
  }
  for (const key of ['gmv', 'shopGmv', 'affiliateGmv', 'views', 'ret',
    ...perLevel('crl'), ...perLevel('ncl'), ...perLevel('vl'),
    ...perLevel('gl'), ...perLevel('vwl'), ...perLevel('ml'), ...perLevel('sl'), ...perLevel('sal')]) {
    series(mc, 'monthly_charts', key, nMonths)
  }
  for (const key of ['gmv', 'orders', 'videos', 'views', 'creators', 'newCreators', 'msgs', 'samples'] as const) {
    if (n(d[key]) < 0) issues.push(`d30 ${key}: is negative — re-pull the 30d totals`)
  }

  return issues
}

// Which data phases produced the numbers behind a validation issue, so a
// failed save re-pulls exactly those instead of the whole report. Keys match
// the phase numbers in api/jobs/run (12 C1, 13 C2P, 14 C3/C4, 15 C5,
// 16 D1, 17 D2P, 18 D3/D4, 21 C2V, 22 D2V).
const SERIES_PHASE: Record<string, number> = {
  'weekly_charts.gmv': 12,
  'weekly_charts.views': 14, 'weekly_charts.ret': 14, 'weekly_charts.vid': 14,
  'monthly_charts.gmv': 16, 'monthly_charts.shopGmv': 16, 'monthly_charts.affiliateGmv': 16, 'monthly_charts.views': 16,
  'monthly_charts.ret': 18
}
const SERIES_PREFIX_PHASE: [RegExp, number][] = [
  [/^weekly_charts\.(crl|ncl|vl)\d$/, 13],
  [/^weekly_charts\.(gl|vwl)\d$/, 21],
  [/^weekly_charts\.(ml|sl)\d$/, 15],
  [/^monthly_charts\.(crl|ncl|vl)\d$/, 17],
  [/^monthly_charts\.(gl|vwl)\d$/, 22],
  [/^monthly_charts\.(ml|sl|sal)\d$/, 18]
]

export function phasesForIssue(issue: string): number[] {
  if (issue.startsWith('tier ')) return [1, 3]
  if (issue.startsWith('GMV Max spend')) return [6, 7]
  // per-tier weekly sums reconcile against pinned totals — only the split re-runs
  if (issue.startsWith('weekly ')) return [21]
  if (issue.startsWith('d30 ')) return [1]
  const m = /^series ([\w.]+):/.exec(issue)
  if (m) {
    const key = m[1]
    if (SERIES_PHASE[key] !== undefined) return [SERIES_PHASE[key]]
    for (const [re, phase] of SERIES_PREFIX_PHASE) if (re.test(key)) return [phase]
  }
  return []
}
