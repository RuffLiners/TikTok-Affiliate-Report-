import { ADDITIVE_KEYS, LINE_BY_KEY, LineKey } from './types'

export const round2 = (n: number) => Math.round(n * 100) / 100

export function roundFor(key: LineKey, n: number): number {
  return LINE_BY_KEY[key].kind === 'money' ? round2(n) : Math.round(n)
}

/** ROI = revenue / spend. null when either side is missing or spend is not positive. Never 0 from missing data. */
export function computeRoi(revenue: number | null | undefined, spend: number | null | undefined): number | null {
  if (revenue == null || spend == null || !(spend > 0)) return null
  return round2(revenue / spend)
}

export function pctChange(cur: number | null | undefined, prior: number | null | undefined): number | null {
  if (cur == null || prior == null || prior === 0) return null
  return Math.round(((cur - prior) / Math.abs(prior)) * 1000) / 10
}

/** Straight-line estimate: (month to date / days elapsed) x days in month. null stays null. */
export function projectValue(key: LineKey, mtd: number | null | undefined, daysElapsed: number, daysInMonth: number): number | null {
  if (mtd == null || !(daysElapsed > 0)) return null
  return roundFor(key, (mtd / daysElapsed) * daysInMonth)
}

/** Sum that keeps "no data" distinct from zero. Returns value null only when every input is null. */
export function sumKnown(values: Array<number | null | undefined>): { value: number | null; missing: number } {
  let total = 0, known = 0, missing = 0
  for (const v of values) { if (v == null) missing++; else { total += v; known++ } }
  return { value: known ? total : null, missing }
}

export { ADDITIVE_KEYS }
