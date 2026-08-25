// Last-line sanity check for auto-generated reports: compare the new report's
// headline numbers against the most recent prior report of the same type. A
// d30 metric moving more than ±60% window-over-window, a $0 GMV total, or an
// all-zero weekly GMV series is far more likely to be an extraction failure
// than a real business event — those reports save flagged as needsReview and
// are held out of the live snapshot until a human confirms them.
//
// Every flag carries a stable `key` so a human can mark it reviewed/expected
// (stored in app_config key 'reviewed_flags' via /api/admin/review-flags).
// Reviewed flags are demoted to informational reconciliation notes instead of
// needsReview, so a known one-time correction (e.g. the views-source fix that
// legitimately moved 30d views +182%) doesn't re-fire on every regeneration.
const REVIEW_PCT = 60

export type ReviewFlag = { key: string; text: string }

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

const fmt = (v: number) => Math.round(v).toLocaleString('en-US')

export function sanityDiffVsPrior(report: any, priorD30: any | null): ReviewFlag[] {
  const flags: ReviewFlag[] = []
  const d = report?.d30 ?? {}

  if (num(d.gmv) <= 0) {
    flags.push({ key: 'zero:gmv', text: '30d affiliate GMV is $0 — almost certainly an extraction failure, verify against Euka before trusting this report' })
  }

  const weeklyGmv: unknown[] = report?.weekly_charts?.gmv ?? []
  if (weeklyGmv.length > 0 && weeklyGmv.every(v => num(v) === 0)) {
    flags.push({ key: 'zeros:weeklyGmv', text: 'weekly GMV series is all zeros across 13 weeks — verify against Euka' })
  }

  if (priorD30) {
    for (const { key, label } of KEYS) {
      const cur = num(d[key])
      const prev = num(priorD30[key])
      if (prev <= 0) continue
      const pct = ((cur - prev) / prev) * 100
      if (Math.abs(pct) > REVIEW_PCT) {
        flags.push({ key: `swing:${key}`, text: `${label} moved ${pct > 0 ? '+' : ''}${Math.round(pct)}% vs the prior report (${fmt(prev)} → ${fmt(cur)}) — outside the ±${REVIEW_PCT}% plausible range, spot-check against Euka` })
      }
    }
  }

  return flags
}

// Tier GMV must decompose d30.gmv (= SUM(creator_store_performance.gmv),
// which the tier query is pinned to) to the dollar. It is NOT expected to
// sum to d30.affiliateGmv — that field is Euka's dashboard totalAffiliateGMV,
// a differently-attributed metric that runs lower by design. See
// TIER_GMV_DEFINITION_NOTE for the banner wording.
const LVLS = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'] as const
export const TIER_SUM_TOLERANCE_USD = 1

export function tierSumFlags(d30: any): ReviewFlag[] {
  const tiers = d30?.tiers ?? {}
  const sum = LVLS.reduce((a, k) => a + num(tiers[k]?.gmv), 0)
  const total = num(d30?.gmv)
  if (!total && !sum) return []
  if (Math.abs(sum - total) > TIER_SUM_TOLERANCE_USD) {
    return [{ key: 'tiergap:gmv', text: `tier GMV: L1..L7 sum to $${fmt(sum)} but d30.gmv is $${fmt(total)} — the tier query decomposes d30.gmv (SUM of creator_store_performance.gmv) and must match within $${TIER_SUM_TOLERANCE_USD}; re-verify the tier split against Euka` }]
  }
  return []
}

// Informational line for the reconciliation banner documenting the expected
// relationship between the two GMV sources, so the tiers-vs-affiliateGmv gap
// is never mistaken for a fan-out bug again.
export function tierDefinitionNote(d30: any): string | null {
  const gmv = num(d30?.gmv), aff = num(d30?.affiliateGmv)
  if (!gmv || !aff || Math.abs(gmv - aff) <= 1) return null
  return `Note: tier GMV sums to d30.gmv ($${fmt(gmv)} = SUM(creator_store_performance.gmv), video + livestream + showcase creator GMV) by design; d30.affiliateGmv ($${fmt(aff)}) is Euka's dashboard totalAffiliateGMV, a differently-attributed metric that is expected to be lower — the gap is not an error.`
}

// Any monetary value that is an exact round multiple of $10,000 is flagged
// for a manual spot-check: fabricated auto-generated values have shipped
// before, and real extracted figures are almost never perfectly round.
// (A value can be genuinely round in the source — e.g. Euka stores some
// creators' global gmv_30d_num as a bucketed round figure — in which case a
// human marks the flag reviewed once and it stays demoted.)
const ROUND_UNIT = 10_000
const TABLE_MONEY_FIELDS = ['sgmv', 'ggmv', 'gmv', 'gmvN', 'gmvT'] as const
const D30_MONEY_FIELDS = ['gmv', 'shopGmv', 'affiliateGmv'] as const

const isSuspiciouslyRound = (v: number) => v >= ROUND_UNIT && v % ROUND_UNIT === 0

export function roundNumberFlags(report: any): ReviewFlag[] {
  const flags: ReviewFlag[] = []
  const d = report?.d30 ?? {}
  for (const f of D30_MONEY_FIELDS) {
    const v = num(d[f])
    if (isSuspiciouslyRound(v)) {
      flags.push({ key: `round:d30.${f}:${v}`, text: `d30.${f} is exactly $${fmt(v)} — a perfectly round multiple of $${fmt(ROUND_UNIT)}; spot-check against Euka that this is a real value, not a fabricated one` })
    }
  }
  const spend = num(d.gmvMax?.spend), rev = num(d.gmvMax?.revenue)
  if (isSuspiciouslyRound(spend)) flags.push({ key: `round:d30.gmvMax.spend:${spend}`, text: `d30.gmvMax.spend is exactly $${fmt(spend)} — a perfectly round multiple of $${fmt(ROUND_UNIT)}; spot-check against Euka` })
  if (isSuspiciouslyRound(rev)) flags.push({ key: `round:d30.gmvMax.revenue:${rev}`, text: `d30.gmvMax.revenue is exactly $${fmt(rev)} — a perfectly round multiple of $${fmt(ROUND_UNIT)}; spot-check against Euka` })

  const tables = report?.tables ?? {}
  for (const [tName, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows)) continue
    for (const row of rows as any[]) {
      if (!row || typeof row !== 'object') continue
      for (const f of TABLE_MONEY_FIELDS) {
        const v = num(row[f])
        if (isSuspiciouslyRound(v)) {
          const who = typeof row.h === 'string' && row.h ? row.h : '?'
          flags.push({ key: `round:tables.${tName}.${f}:${who}:${v}`, text: `tables.${tName}: ${who} has ${f} exactly $${fmt(v)} — a perfectly round multiple of $${fmt(ROUND_UNIT)}; verify the value comes from an actual Euka result, not an estimate` })
        }
      }
    }
  }
  return flags
}

// All review flags for a report in one call.
export function collectReviewFlags(report: any, priorD30: any | null): ReviewFlag[] {
  const all = [
    ...sanityDiffVsPrior(report, priorD30),
    ...tierSumFlags(report?.d30),
    ...roundNumberFlags(report)
  ]
  // dedup by key — the same value can be reachable twice
  const seen = new Set<string>()
  return all.filter(fl => (seen.has(fl.key) ? false : (seen.add(fl.key), true)))
}

// Partition flags into still-active needsReview vs human-reviewed/expected.
export function splitReviewed(flags: ReviewFlag[], reviewedKeys: string[] | Set<string>): { active: ReviewFlag[]; reviewed: ReviewFlag[] } {
  const set = reviewedKeys instanceof Set ? reviewedKeys : new Set(reviewedKeys)
  const active: ReviewFlag[] = [], reviewed: ReviewFlag[] = []
  for (const fl of flags) (set.has(fl.key) ? reviewed : active).push(fl)
  return { active, reviewed }
}
