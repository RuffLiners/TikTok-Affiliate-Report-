// Restatement check. TikTok can revise numbers after a period settles (refunds, late attribution). Every run re-pulls the
// most recent final periods and compares them with what is stored. If anything changed, the look-back widens
// (3 months, then 6, then full history) until a stage comes back clean. Pure apart from `pullFresh`, so it is unit-tested.
import { RangeRaw, addDays } from '../../tiktok-dashboard/src/lib/scorecard/index'
import type { StoredPeriod } from './plan.js'

/** Only fields Euka restates. Usage rights (snapshots) and contests (own store) are not compared. */
export const COMPARE_FIELDS = ['shopGmv', 'gmvMaxSpend', 'gmvMaxRevenue', 'targetInvites', 'emails', 'eukaMessages', 'videos', 'samplesApproved', 'creatorsPosted', 'views'] as const
export type CompareField = typeof COMPARE_FIELDS[number]
const MONEY = new Set<string>(['shopGmv', 'gmvMaxSpend', 'gmvMaxRevenue'])
/** Tolerances live here, in one place. Money: more than the larger of $1 or 0.1%. Counts: more than 0.1% (so 572 videos vs 573 is a change). */
export const MONEY_ABS = 1
export const REL = 0.001

export interface Diff { field: CompareField; stored: number | null; fresh: number | null }
export interface DriftRow extends Diff { period_type: 'week' | 'month'; period_key: string; stage: string }

export function differs(field: string, stored: number | null | undefined, fresh: number | null | undefined): boolean {
  const a = stored ?? null, b = fresh ?? null
  if (a === null && b === null) return false
  if (a === null || b === null) return true            // data appeared or disappeared
  const tol = MONEY.has(field) ? Math.max(MONEY_ABS, REL * Math.abs(a)) : REL * Math.abs(a)
  return Math.abs(a - b) > tol
}
export function compareRaw(stored: RangeRaw, fresh: RangeRaw): Diff[] {
  const out: Diff[] = []
  for (const f of COMPARE_FIELDS) if (differs(f, stored[f], fresh[f])) out.push({ field: f, stored: stored[f] ?? null, fresh: fresh[f] ?? null })
  return out
}

export interface Stage { name: string; periods: StoredPeriod[] }
/** Stages are disjoint and ordered newest first: previous period, last 3 months, last 6 months, full history. */
export function lookbackStages(stored: StoredPeriod[], dataThrough: string): Stage[] {
  const finals = stored.filter(p => p.final).sort((a, b) => b.end_date.localeCompare(a.end_date))
  const weeks = finals.filter(p => p.period_type === 'week'), months = finals.filter(p => p.period_type === 'month')
  const probe = [...weeks.slice(0, 2), ...months.slice(0, 1)]
  const used = new Set(probe.map(p => `${p.period_type}:${p.period_key}`))
  const within = (days: number) => finals.filter(p => p.end_date >= addDays(dataThrough, -days) && !used.has(`${p.period_type}:${p.period_key}`))
  const stages: Stage[] = [{ name: 'previous period', periods: probe }]
  const s3 = within(91); s3.forEach(p => used.add(`${p.period_type}:${p.period_key}`)); stages.push({ name: 'last 3 months', periods: s3 })
  const s6 = within(182); s6.forEach(p => used.add(`${p.period_type}:${p.period_key}`)); stages.push({ name: 'last 6 months', periods: s6 })
  stages.push({ name: 'full history', periods: finals.filter(p => !used.has(`${p.period_type}:${p.period_key}`)) })
  return stages
}

export interface RestatementResult {
  /** The deepest stage that was re-pulled. */
  stageReached: string
  checked: number
  drift: DriftRow[]
  /** Stored periods with their drifted fields replaced by the fresh values (still final). */
  replaced: StoredPeriod[]
  /** true when the first stage came back clean, so nothing older was touched. */
  clean: boolean
}

export async function restatementCheck(
  stored: StoredPeriod[], dataThrough: string,
  pullFresh: (periods: StoredPeriod[]) => Promise<StoredPeriod[]>,
): Promise<RestatementResult> {
  const res: RestatementResult = { stageReached: 'none (nothing final stored yet)', checked: 0, drift: [], replaced: [], clean: true }
  for (const stage of lookbackStages(stored, dataThrough)) {
    if (!stage.periods.length) continue
    res.stageReached = stage.name
    const fresh = await pullFresh(stage.periods)
    res.checked += stage.periods.length
    const byKey = new Map(fresh.map(f => [`${f.period_type}:${f.period_key}`, f]))
    let stageDrift = 0
    for (const old of stage.periods) {
      const f = byKey.get(`${old.period_type}:${old.period_key}`)
      if (!f) continue
      const diffs = compareRaw(old.raw, f.raw)
      if (!diffs.length) continue
      stageDrift += diffs.length
      for (const d of diffs) res.drift.push({ ...d, period_type: old.period_type, period_key: old.period_key, stage: stage.name })
      const merged: RangeRaw = { ...old.raw }
      for (const d of diffs) merged[d.field] = d.fresh
      res.replaced.push({ ...old, raw: merged, final: true })
    }
    if (stageDrift === 0) break          // this stage is clean: older data is not re-checked
    res.clean = false
  }
  return res
}
