// LLM-extracted table rows can carry null (or NaN) in fields the UI and
// reconciliation math expect to be numbers — e.g. a video whose views/likes
// the source couldn't provide. Saved reports must never hold those.
const NULLABLE = new Set(['eng', 'clicks']) // legitimately null, UI shows '—'
const TEXT = new Set(['h', 'prod', 'date', 'label', 'name'])

export function sanitizeRows(rows: any): any[] {
  if (!Array.isArray(rows)) return []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    for (const [k, v] of Object.entries(row)) {
      if (NULLABLE.has(k)) continue
      if (v == null || (typeof v === 'number' && !Number.isFinite(v))) {
        row[k] = TEXT.has(k) ? '' : 0
      }
    }
  }
  return rows
}

export function sanitizeTables<T>(tables: T): T {
  if (tables && typeof tables === 'object') {
    for (const k of Object.keys(tables)) (tables as any)[k] = sanitizeRows((tables as any)[k])
  }
  return tables
}
