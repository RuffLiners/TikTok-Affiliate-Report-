// Decides what a run must pull. Pure, so it is unit-tested.
import { RangeRaw, addDays, monthRanges, weekRangesSince } from '../../tiktok-dashboard/src/lib/scorecard/index'

/** A period is final once it ended this many days before the data cutoff: TikTok's numbers have settled by then. */
export const SETTLE_DAYS = 14
/** Bump when a line's definition or source changes. Every stored period is then re-pulled once. */
export const RAW_VERSION = 1

export interface Wanted { type: 'week' | 'month'; key: string; start: string; end: string; partial: boolean }
export interface StoredPeriod { period_type: 'week' | 'month'; period_key: string; start_date: string; end_date: string; raw: RangeRaw; raw_version: number; final: boolean }

export function wantedPeriods(asOf: string, dataThrough: string, yearStart: string): Wanted[] {
  const weeks = weekRangesSince(asOf, yearStart).map(w => ({ type: 'week' as const, key: w.key, start: w.start, end: w.end, partial: false }))
  const months = monthRanges(dataThrough).map(m => ({ type: 'month' as const, key: m.key, start: m.start, end: m.end, partial: m.partial }))
  return [...weeks, ...months]
}

export const isSettled = (end: string, dataThrough: string, partial: boolean) => !partial && end <= addDays(dataThrough, -SETTLE_DAYS)

export interface Plan { toPull: Wanted[]; reused: StoredPeriod[]; reasons: Record<string, string> }

export function planPulls(wanted: Wanted[], stored: StoredPeriod[], opts: { force?: boolean } = {}): Plan {
  const byKey = new Map(stored.map(s => [`${s.period_type}:${s.period_key}`, s]))
  const toPull: Wanted[] = [], reused: StoredPeriod[] = [], reasons: Record<string, string> = {}
  for (const w of wanted) {
    const id = `${w.type}:${w.key}`, s = byKey.get(id)
    const why = opts.force ? 'forced refresh' : !s ? 'not stored yet' : s.raw_version !== RAW_VERSION ? 'definition changed' : !s.final ? 'not settled yet' : null
    if (why) { toPull.push(w); reasons[id] = why } else reused.push(s!)
  }
  return { toPull, reused, reasons }
}

/** The span of days the daily series must cover to build the periods being pulled. null when nothing is pulled. */
export function dailySpan(toPull: Wanted[]): { from: string; to: string } | null {
  if (!toPull.length) return null
  return { from: toPull.reduce((m, w) => (w.start < m ? w.start : m), toPull[0].start), to: toPull.reduce((m, w) => (w.end > m ? w.end : m), toPull[0].end) }
}
