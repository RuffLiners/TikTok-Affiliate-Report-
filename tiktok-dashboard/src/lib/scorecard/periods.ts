// Pure string-date arithmetic (UTC, no timezone drift). Callers pass dates
// already expressed in America/Los_Angeles.
import { LAUNCH_MONTH } from './types'

const MS = 86400000
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const fmt = (t: number) => new Date(t).toISOString().slice(0, 10)

export const addDays = (s: string, n: number) => fmt(parse(s) + n * MS)
export const dayOfWeek = (s: string) => new Date(parse(s)).getUTCDay() // 0 = Sunday
export const monthOf = (s: string) => s.slice(0, 7)
export const daysInMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate() }
export const monthStart = (ym: string) => `${ym}-01`
export const monthEnd = (ym: string) => `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}`
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

export interface WeekRange { key: string; start: string; end: string }

/** Sunday to Saturday weeks, most recent COMPLETE week first. A week is complete once its Saturday is before asOf. */
export function weekRanges(asOf: string, n = 13): WeekRange[] {
  const yesterday = addDays(asOf, -1)
  const lastSat = addDays(yesterday, -((dayOfWeek(yesterday) + 1) % 7))
  return Array.from({ length: n }, (_, i) => {
    const end = addDays(lastSat, -7 * i)
    const start = addDays(end, -6)
    return { key: start, start, end }
  })
}

export interface MonthRange { key: string; start: string; end: string; daysElapsed: number; daysInMonth: number; partial: boolean }

/** Calendar months from launch to the month containing dataThrough, current month first. The current month ends at dataThrough. */
export function monthRanges(dataThrough: string): MonthRange[] {
  const cur = monthOf(dataThrough)
  const out: MonthRange[] = []
  for (let ym = cur; ym >= LAUNCH_MONTH; ym = addMonths(ym, -1)) {
    const dim = daysInMonth(ym)
    const isCur = ym === cur
    const daysElapsed = isCur ? Number(dataThrough.slice(8, 10)) : dim
    out.push({ key: ym, start: monthStart(ym), end: isCur ? dataThrough : monthEnd(ym), daysElapsed, daysInMonth: dim, partial: daysElapsed < dim })
  }
  return out
}

/** The week/month a given date belongs to, for manual-entry lookups. */
export const weekKeyOf = (date: string) => addDays(date, -dayOfWeek(date))
