import { LINE_BY_KEY, LineKey, Scorecard } from './types'

export interface TodoItem { period_type: 'week' | 'month'; period_key: string; start: string; end: string; label: string; partial: boolean }
export interface SpotCheckTodo { month: string; start: string; end: string; missing: Array<{ line: LineKey; euka: number | null }> }
export interface Todo {
  asOf: string
  dataThrough: string
  /** Seller Center "Gross merchandise value (with TikTok co-funding)": the only line with no Euka source. Newest first. */
  cofunded: TodoItem[]
  /** Monthly Seller Center values to compare with Euka (Gross Revenue, GMV, GMV Max cost, ROI). */
  spotCheck: SpotCheckTodo | null
  /**
   * Lines Euka returned nothing for (outside its history) that a person can fill from Seller Center: TikTok GMV,
   * Gross Revenue and Views. Newest first. Filling is optional; an empty cell stays "no data".
   */
  history: HistoryTodo[]
  summary: string
}
export interface HistoryTodo extends TodoItem { lines: LineKey[] }
/** History lines with a Seller Center equivalent. Euka messages has none, so it is never asked for. */
export const HISTORY_FILL_KEYS: LineKey[] = ['gmv', 'grossRevenue', 'views']

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
  const history: HistoryTodo[] = []
  const gaps = (lines: Scorecard['weekly'][number]['lines']) => HISTORY_FILL_KEYS.filter(k => lines[k].value == null)
  for (const m of sc.monthly) { const l = gaps(m.lines); if (l.length) history.push({ period_type: 'month', period_key: m.key, start: m.start, end: m.end, label: m.partial ? `${m.key} month to date (through ${m.end})` : m.key, partial: m.partial, lines: l }) }
  for (const w of weeks) { const l = gaps(w.lines); if (l.length) history.push({ period_type: 'week', period_key: w.key, start: w.start, end: w.end, label: `Week ${w.start} to ${w.end}`, partial: false, lines: l }) }
  const chk = sc.sellerCenterCheck
  const done = sc.monthly.find(m => !m.partial)
  const missing = chk.rows.filter(r => r.status === 'no_seller_center_value').map(r => ({ line: r.line as LineKey, euka: r.euka }))
  const spotCheck = done && missing.length ? { month: chk.period, start: done.start, end: done.end, missing } : null
  const wk = cofunded.filter(c => c.period_type === 'week').length, mo = cofunded.filter(c => c.period_type === 'month').length
  return {
    asOf: sc.asOf, dataThrough: sc.dataThrough, cofunded, spotCheck, history,
    summary: `${wk} week(s) and ${mo} month(s) need co-funded GMV${spotCheck ? `; ${spotCheck.missing.length} spot-check value(s) needed for ${spotCheck.month}` : '; spot-check complete'}. ${history.length ? `${history.length} period(s) have history gaps Euka cannot fill (${HISTORY_FILL_KEYS.filter(k => history.some(h => h.lines.includes(k))).map(k => LINE_BY_KEY[k].label).join(', ')}).` : 'No history gaps.'}`,
  }
}
