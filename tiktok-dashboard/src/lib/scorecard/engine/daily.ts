// Pure helpers: merge Euka's daily series and sum them over a period without ever turning "no data" into 0.
import { addDays } from '../index'

export interface Daily { shopGmv?: number; videos?: number; messages?: number; invites?: number; emails?: number; spend?: number; revenue?: number }
export type DailyMap = Record<string, Daily>
export type Field = keyof Daily

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Merge one get_dashboard_performance_series response. Rows missing from the response stay missing. */
export function mergeSeries(into: DailyMap, series: any): void {
  const d = series?.data ?? {}
  const put = (date: string, f: Field, v: unknown) => { const n = num(v); if (n !== undefined && date) (into[date] ??= {})[f] = n }
  for (const r of d.videoPosted ?? []) put(r.date, 'videos', r.videos_posted)
  for (const r of d.performances ?? []) put(r.date, 'shopGmv', r.total_shop_gmv)
  for (const r of d.analyticsAggregated ?? []) {
    put(r.date, 'messages', r.messages_sent); put(r.date, 'invites', r.target_invites); put(r.date, 'emails', r.emails_sent)
  }
}
/** Merge get_dashboard_ads_overview daily rows (GMV Max cost and attributed revenue). */
export function mergeAds(into: DailyMap, ads: any): void {
  for (const r of ads?.dailyRoas ?? []) {
    const c = num(r.cost), v = num(r.revenue)
    if (c !== undefined) (into[r.date] ??= {}).spend = c
    if (v !== undefined) (into[r.date] ??= {}).revenue = v
  }
}

export interface SumOpts {
  /** First day the source has data (GMV Max history). Missing days before it are not "missing"; a period wholly before it is null. */
  historyFrom?: string
}
/**
 * Sum a field over [a, b]. All days present: the sum. No days: null. Some days missing: null, and the gap is reported,
 * because a partial sum would silently understate the period.
 */
export function sumRange(daily: DailyMap, a: string, b: string, f: Field, opts: SumOpts = {}, gaps?: string[]): number | null {
  const start = opts.historyFrom && a < opts.historyFrom ? opts.historyFrom : a
  if (start > b) return null
  let total = 0, have = 0, want = 0
  for (let d = start; d <= b; d = addDays(d, 1)) { want++; const v = daily[d]?.[f]; if (v !== undefined) { total += v; have++ } }
  if (have === 0) return null
  if (have < want) { gaps?.push(`${f} ${a}..${b}: ${have} of ${want} days have data`); return null }
  return Math.round(total * 100) / 100
}

export const chunks = (a: string, b: string, days: number): Array<[string, string]> => {
  const out: Array<[string, string]> = []
  for (let s = a; s <= b; s = addDays(s, days)) { const e = addDays(s, days - 1); out.push([s, e > b ? b : e]) }
  return out
}

/** Snapshot at or just after a date (snapshots are taken early each morning, so they describe the end of the day before). */
export function snapshotOnOrAfter(snaps: Array<{ snap_date: string; value: number }>, date: string, maxGapDays = 3): number | null {
  const hit = snaps.filter(s => s.snap_date >= date && s.snap_date <= addDays(date, maxGapDays)).sort((x, y) => x.snap_date.localeCompare(y.snap_date))[0]
  return hit ? hit.value : null
}
