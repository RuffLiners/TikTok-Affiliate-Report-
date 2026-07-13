// Report data is extracted by an LLM — any "numeric" field can arrive as
// null, undefined, or a string, and one bad leaf must not 500 a page render.
export const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(/[$,%,]/g, '')) : Number(v)
  return Number.isFinite(n) ? n : 0
}

export const fmtNum = (v: unknown) => num(v).toLocaleString('en-US')
export const fmtUsd = (v: unknown) => '$' + Math.round(num(v)).toLocaleString('en-US')
export const fmtUsd2 = (v: unknown) => '$' + num(v).toFixed(2)
