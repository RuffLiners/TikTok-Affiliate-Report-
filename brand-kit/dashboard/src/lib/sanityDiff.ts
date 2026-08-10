// Last-line sanity check for auto-generated reports: compare the new report's
// headline numbers against the most recent prior report of the same type. A
// d30 metric moving more than ±60% window-over-window, a $0 GMV total, or an
// all-zero weekly GMV series is far more likely to be an extraction failure
// than a real business event — those reports save flagged as needsReview and
// are held out of the live snapshot until a human confirms them.
const REVIEW_PCT = 60

const KEYS: { key: string; label: string }[] = [
  { key: 'gmv', label: '30d affiliate GMV' },
  { key: 'orders', label: '30d orders' },
  { key: 'videos', label: '30d videos' },
  { key: 'views', label: '30d views' },
  { key: 'creators', label: '30d creators' },
  { key: 'newCreators', label: '30d new creators' },
  { key: 'msgs', label: '30d messages' },
  { key: 'samples', label: '30d samples' }
]

const num = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export function sanityDiffVsPrior(report: any, priorD30: any | null): string[] {
  const flags: string[] = []
  const d = report?.d30 ?? {}

  if (num(d.gmv) <= 0) {
    flags.push('30d affiliate GMV is $0 — almost certainly an extraction failure, verify against Euka before trusting this report')
  }

  const weeklyGmv: unknown[] = report?.weekly_charts?.gmv ?? []
  if (weeklyGmv.length > 0 && weeklyGmv.every(v => num(v) === 0)) {
    flags.push('weekly GMV series is all zeros across 13 weeks — verify against Euka')
  }

  if (priorD30) {
    for (const { key, label } of KEYS) {
      const cur = num(d[key])
      const prev = num(priorD30[key])
      if (prev <= 0) continue
      const pct = ((cur - prev) / prev) * 100
      if (Math.abs(pct) > REVIEW_PCT) {
        flags.push(`${label} moved ${pct > 0 ? '+' : ''}${Math.round(pct)}% vs the prior report (${Math.round(prev).toLocaleString('en-US')} → ${Math.round(cur).toLocaleString('en-US')}) — outside the ±${REVIEW_PCT}% plausible range, spot-check against Euka`)
      }
    }
  }

  return flags
}
