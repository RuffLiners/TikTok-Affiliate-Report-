import { CHECK_ONLY_KEYS, LINE_KEYS, LineKey, MANUAL_KEYS, ManualEntry } from './types'

export interface CsvResult { entries: ManualEntry[]; skipped: number; errors: string[] }

function splitRow(line: string): string[] {
  const out: string[] = []; let cur = '', q = false
  for (const ch of line) {
    if (ch === '"') q = !q
    else if (ch === ',' && !q) { out.push(cur.trim()); cur = '' }
    else cur += ch
  }
  out.push(cur.trim()); return out
}

/**
 * Seller Center history import. Columns: period_type (week|month), period_key (Sunday date for a week, YYYY-MM for a month),
 * then one column per line key. A blank cell is "no data": it is skipped, never stored as 0.
 */
export function parseSellerCenterCsv(text: string, source: ManualEntry['source'] = 'seller_center', enteredBy = 'csv-import'): CsvResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim())
  const res: CsvResult = { entries: [], skipped: 0, errors: [] }
  if (!lines.length) { res.errors.push('Empty file'); return res }
  const head = splitRow(lines[0]).map(h => h.trim())
  const ti = head.indexOf('period_type'), ki = head.indexOf('period_key')
  if (ti < 0 || ki < 0) { res.errors.push('Header must start with period_type,period_key'); return res }
  const cols = head.map((h, i) => ({ h, i })).filter(c => c.i !== ti && c.i !== ki)
  const allowed = [...new Set([...MANUAL_KEYS, ...CHECK_ONLY_KEYS])]
  for (const c of cols) if (!allowed.includes(c.h as LineKey)) res.errors.push(`Unknown column "${c.h}". Allowed: ${allowed.join(', ')}`)
  if (res.errors.length) return res
  const now = new Date().toISOString()
  lines.slice(1).forEach((ln, idx) => {
    const r = splitRow(ln)
    const type = r[ti], key = r[ki]
    if (type !== 'week' && type !== 'month' && type !== 'month_check') { res.errors.push(`Row ${idx + 2}: period_type must be week, month or month_check`); return }
    if (type !== 'week' ? !/^\d{4}-\d{2}$/.test(key) : !/^\d{4}-\d{2}-\d{2}$/.test(key)) { res.errors.push(`Row ${idx + 2}: bad period_key "${key}"`); return }
    for (const c of cols) {
      const okKeys = type === 'month_check' ? CHECK_ONLY_KEYS : MANUAL_KEYS
      if (!okKeys.includes(c.h as LineKey)) { if ((r[c.i] ?? '').trim()) res.errors.push(`Row ${idx + 2}: ${c.h} is not allowed for period_type ${type}`); continue }
      const raw = (r[c.i] ?? '').replace(/[$,\s]/g, '')
      if (raw === '' || /^(no data|n\/a|-)$/i.test(raw)) { res.skipped++; continue }
      const v = Number(raw)
      if (!Number.isFinite(v) || v < 0) { res.errors.push(`Row ${idx + 2} ${c.h}: "${r[c.i]}" is not a non-negative number`); continue }
      res.entries.push({ period_type: type, period_key: key, line: c.h as LineKey, value: v, source, entered_by: enteredBy, entered_at: now })
    }
  })
  return res
}
export { LINE_KEYS }
