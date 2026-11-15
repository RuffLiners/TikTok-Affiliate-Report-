import { LineKey, Scorecard } from './types'

export interface TodoItem { period_type: 'week' | 'month'; period_key: string; start: string; end: string; label: string; partial: boolean }
export interface SpotCheckTodo { month: string; start: string; end: string; missing: Array<{ line: LineKey; euka: number | null }> }
export interface Todo {
  asOf: string
  dataThrough: string
  /** Seller Center "Gross merchandise value (with TikTok co-funding)": the only line with no Euka source. Newest first. */
  cofunded: TodoItem[]
  /** Monthly Seller Center values to compare with Euka (Gross Revenue, GMV, GMV Max cost, ROI). */
  spotCheck: SpotCheckTodo | null
  summary: string
}

/** What a person (or Claude in Chrome) still has to read from Seller Center and enter. Pure and derived from the scorecard. */
export function buildTodo(sc: Scorecard): Todo {
  const weeks = sc.weeklyAll ?? sc.weekly
  const cofunded: TodoItem[] = []
  for (const m of sc.monthly) {
    if (m.lines.gmvCofunded.value == null) cofunded.push({ period_type: 'month', period_key: m.key, start: m.start, end: m.end, label: m.partial ? `${m.key} month to date (through ${m.end})` : m.key, partial: m.partial })
  }
  for (const w of weeks) {
    if (w.lines.gmvCofunded.value == null) cofunded.push({ period_type: 'week', period_key: w.key, start: w.start, end: w.end, label: `Week ${w.start} to ${w.end}`, partial: false })
  }
  const chk = sc.sellerCenterCheck
  const done = sc.monthly.find(m => !m.partial)
  const missing = chk.rows.filter(r => r.status === 'no_seller_center_value').map(r => ({ line: r.line as LineKey, euka: r.euka }))
  const spotCheck = done && missing.length ? { month: chk.period, start: done.start, end: done.end, missing } : null
  const wk = cofunded.filter(c => c.period_type === 'week').length, mo = cofunded.filter(c => c.period_type === 'month').length
  return {
    asOf: sc.asOf, dataThrough: sc.dataThrough, cofunded, spotCheck,
    summary: `${wk} week(s) and ${mo} month(s) need co-funded GMV${spotCheck ? `; ${spotCheck.missing.length} spot-check value(s) needed for ${spotCheck.month}` : '; spot-check complete'}.`,
  }
}
