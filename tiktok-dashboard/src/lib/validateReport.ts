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

  return issues
}
