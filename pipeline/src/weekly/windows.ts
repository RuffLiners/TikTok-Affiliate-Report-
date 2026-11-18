// SKILL.md Phase 1: date windows for the weekly report, all Pacific calendar dates (YYYY-MM-DD).
const DAY = 86400000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const addDays = (d: string, n: number): string => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10)
const dow = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay() // 0 = Sunday

export interface Windows {
  report_date: string
  cur: [string, string]          // 30 days ending on the week's Saturday
  prior: [string, string]        // the 30 days before
  week: [string, string]         // most recent complete Sun to Sat week
  week_starts: string[]          // 13 Sundays, oldest first, the last one is week[0]
  months: Array<[string, string, string]> // [label, start, end]; the last is the current month, label ends in "*"
}

/** Throws on a malformed, impossible or future date (the run then reports FAILED and saves nothing). */
export function validateReportDate(d: string, today: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d + 'T00:00:00Z')) || new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) !== d) {
    throw new Error(`report date "${d}" is not a valid YYYY-MM-DD date`)
  }
  if (d > today) throw new Error(`report date ${d} is in the future (today is ${today} Pacific)`)
  if (d < '2025-10-01') throw new Error(`report date ${d} is before the data history starts (2025-10-01)`)
}

export function computeWindows(reportDate: string): Windows {
  // Most recent Saturday strictly before the report date: a Monday run uses the Saturday two days earlier
  const back = ((dow(reportDate) + 1) % 7) || 7
  const sat = addDays(reportDate, -back)
  const sun = addDays(sat, -6)
  const week_starts = Array.from({ length: 13 }, (_, i) => addDays(sun, -7 * (12 - i)))
  const [y, m] = reportDate.split('-').map(Number)
  const months: Array<[string, string, string]> = []
  for (let k = 5; k >= 0; k--) {
    const mm = new Date(Date.UTC(y, m - 1 - k, 1))
    const start = mm.toISOString().slice(0, 10)
    const end = k === 0 ? reportDate : new Date(Date.UTC(mm.getUTCFullYear(), mm.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
    months.push([MONTHS[mm.getUTCMonth()] + (k === 0 ? '*' : ''), start, end])
  }
  return {
    report_date: reportDate,
    cur: [addDays(sat, -29), sat],
    prior: [addDays(sat, -59), addDays(sat, -30)],
    week: [sun, sat],
    week_starts,
    months,
  }
}

/** Pacific calendar date of an ISO timestamp. */
export const laDate = (iso: string): string => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
