// CSV reading for the Euka exports. Every cell stays a string: Video ID, Creator ID and Product ID are 19-digit
// numbers that lose digits as JS numbers, so nothing here converts types. The Python build reads the same files as text.

/** RFC 4180 parse: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF, a leading BOM. */
export function parseCsvRows(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => !(r.length === 1 && r[0] === ''))
}

export function parseCsv(text: string): Array<Record<string, string>> {
  const [head, ...rows] = parseCsvRows(text)
  if (!head) return []
  const h = head.map(x => x.trim())
  return rows.map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])))
}

/** Columns the Python build needs from each export. A missing one fails the pull step, not the build. */
export const REQUIRED_COLUMNS = {
  lifetime: ['Date', 'Creator', 'Video ID', 'Views Count'],
  commerceWindow: ['Creator', 'Video ID', 'Video Revenue', 'Items Sold', 'Product'],
  gmvmax: ['Video ID', 'Cost', 'Gross revenue'],
} as const

export function checkColumns(text: string, kind: keyof typeof REQUIRED_COLUMNS): void {
  const head = (parseCsvRows(text.slice(0, 20000))[0] ?? []).map(x => x.trim())
  const missing = REQUIRED_COLUMNS[kind].filter(c => !head.includes(c))
  if (missing.length) throw new Error(`${kind} export is missing column(s): ${missing.join(', ')} (have: ${head.slice(0, 40).join(', ')})`)
}
