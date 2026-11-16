// Monthly contest participation. Each creator counts once per calendar month however many contests they entered.
// A contest belongs to the month it starts in. Completed months are stored (with participant ids) and never re-pulled.
import { addDays } from '../index'
import { SETTLE_DAYS } from './plan'

export interface ContestInfo { id: number; type: string; status: string; startDate: string; endDate: string }
export interface ContestMonth { month: string; creator_ids: string[]; final: boolean }

/** Contests only. Retainers are programs, not contests, and canceled contests never ran. */
export const countsAsContest = (c: ContestInfo) => c.type !== 'retainer' && c.status !== 'canceled'

/** A month is final when every contest that started in it is completed and ended at least SETTLE_DAYS ago. */
export function monthIsFinal(contests: ContestInfo[], dataThrough: string): boolean {
  return contests.every(c => c.status === 'completed' && c.endDate <= addDays(dataThrough, -SETTLE_DAYS))
}

export async function resolveContestMonths(
  all: ContestInfo[], stored: ContestMonth[], dataThrough: string, fetchIds: (contestId: number) => Promise<string[]>,
): Promise<{ months: ContestMonth[]; fresh: ContestMonth[] }> {
  const byMonth = new Map<string, ContestInfo[]>()
  for (const c of all.filter(countsAsContest)) { const m = c.startDate.slice(0, 7); byMonth.set(m, [...(byMonth.get(m) ?? []), c]) }
  const storedBy = new Map(stored.map(s => [s.month, s]))
  const months: ContestMonth[] = [], fresh: ContestMonth[] = []
  for (const [month, list] of [...byMonth.entries()].sort()) {
    const have = storedBy.get(month)
    if (have?.final) { months.push(have); continue }
    const ids = new Set<string>()
    for (const c of list) for (const id of await fetchIds(c.id)) ids.add(id)
    const m: ContestMonth = { month, creator_ids: [...ids].sort(), final: monthIsFinal(list, dataThrough) }
    months.push(m); fresh.push(m)
  }
  return { months, fresh }
}

export interface ContestCounts { byMonth: Record<string, number>; firstMonth: string | null; allTime: number }
export function contestCounts(months: ContestMonth[]): ContestCounts {
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month))
  const all = new Set<string>()
  for (const m of sorted) for (const id of m.creator_ids) all.add(id)
  return { byMonth: Object.fromEntries(sorted.map(m => [m.month, new Set(m.creator_ids).size])), firstMonth: sorted[0]?.month ?? null, allTime: all.size }
}
/** null before the first contest month (no data); 0 for a later month with no contest (a real zero). */
export const contestFor = (c: ContestCounts, month: string): number | null => (c.firstMonth && month >= c.firstMonth ? c.byMonth[month] ?? 0 : null)
