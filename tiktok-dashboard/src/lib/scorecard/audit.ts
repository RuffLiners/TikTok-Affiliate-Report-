import { ADDITIVE_KEYS, LINE_BY_KEY, LINE_KEYS, Lines, Scorecard } from './types'
import { computeRoi, projectValue } from './calc'
import { addDays } from './periods'

export interface AuditResult { status: 'PASS' | 'FAIL'; failures: string[]; warnings: string[] }
const SOURCES = ['euka', 'seller_center', 'manual', 'none']
const near = (a: number | null, b: number | null, tol = 0.0051) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= tol)

function checkLines(where: string, l: Lines, f: string[]) {
  for (const k of LINE_KEYS) {
    const c = l[k]
    if (!c) { f.push(`${where}: line ${k} missing`); continue }
    if (!SOURCES.includes(c.source)) f.push(`${where}.${k}: bad source ${c.source}`)
    if (typeof c.confirmed !== 'boolean') f.push(`${where}.${k}: confirmed must be boolean`)
    if ((c.value === null) !== (c.source === 'none')) f.push(`${where}.${k}: value null must match source none (value=${c.value}, source=${c.source})`)
    if (c.value !== null) {
      if (!Number.isFinite(c.value) || c.value < 0) f.push(`${where}.${k}: invalid value ${c.value}`)
      else if (LINE_BY_KEY[k].kind === 'count' && !Number.isInteger(c.value)) f.push(`${where}.${k}: count is not an integer (${c.value})`)
    }
  }
}

/** Rules a scorecard must satisfy before it can be published. Never edit numbers to pass; fix the source. */
export function auditScorecard(sc: Scorecard): AuditResult {
  const f: string[] = [], w: string[] = []
  if (sc.version !== 1) f.push('scorecard.version must be 1')
  if (!Array.isArray(sc.weekly) || sc.weekly.length !== 13) f.push(`weekly must hold 13 weeks (has ${sc.weekly?.length})`)
  if (!Array.isArray(sc.monthly) || !sc.monthly.length) f.push('monthly is empty')
  if (f.length) return { status: 'FAIL', failures: f, warnings: w }

  const periods = [
    { name: 'allTime', p: sc.allTime },
    ...sc.weekly.map(p => ({ name: `weekly[${p.key}]`, p })),
    ...sc.monthly.map(p => ({ name: `monthly[${p.key}]`, p })),
  ]
  for (const { name, p } of periods) {
    checkLines(name, p.lines, f)
    // ROI must equal revenue / spend, and be null when either side is missing
    const exp = computeRoi(p.gmvMaxRevenue, p.lines.gmvMaxSpend.value)
    if (!near(p.lines.gmvMaxRoi.value, exp)) f.push(`${name}: ROI ${p.lines.gmvMaxRoi.value} != revenue/spend ${exp}`)
    if (!near(p.roiVsShopGmv, computeRoi(p.lines.gmv.value, p.lines.gmvMaxSpend.value))) f.push(`${name}: roiVsShopGmv is not shop GMV / spend`)
  }

  for (const m of sc.monthly) {
    const n = `monthly[${m.key}]`
    if (!(m.daysElapsed >= 1 && m.daysElapsed <= m.daysInMonth)) f.push(`${n}: daysElapsed ${m.daysElapsed} outside 1..${m.daysInMonth}`)
    if (m.partial !== (m.daysElapsed < m.daysInMonth)) f.push(`${n}: partial flag disagrees with daysElapsed`)
    for (const k of LINE_KEYS) if (!near(m.mtd[k], m.lines[k].value, 0)) f.push(`${n}: mtd.${k} differs from lines.${k}`)
    if (!m.partial) { if (m.projected) f.push(`${n}: complete month must not carry a projection`); continue }
    if (!m.projected) { f.push(`${n}: partial month is missing its projection`); continue }
    for (const k of LINE_KEYS) {
      const def = LINE_BY_KEY[k], got = m.projected[k]
      if (def.distinct) { if (got !== null) f.push(`${n}: distinct-people line ${k} must not be projected`); continue }
      if (def.derived) continue
      const exp = projectValue(k, m.mtd[k], m.daysElapsed, m.daysInMonth)
      if (!near(got, exp, def.kind === 'money' ? 0.0051 : 0)) f.push(`${n}: projected.${k}=${got}, formula gives ${exp}`)
    }
    const expRev = projectValue('gmvMaxSpend', m.gmvMaxRevenue, m.daysElapsed, m.daysInMonth)
    if (!near(m.projectedGmvMaxRevenue, expRev)) f.push(`${n}: projectedGmvMaxRevenue ${m.projectedGmvMaxRevenue} != ${expRev}`)
    if (!near(m.projected.gmvMaxRoi, computeRoi(m.projectedGmvMaxRevenue, m.projected.gmvMaxSpend))) f.push(`${n}: projected ROI is not projected revenue / projected spend`)
  }

  // Additive lines: all-time must equal the sum of its months wherever every month has data
  for (const k of ADDITIVE_KEYS) {
    if (['views', 'eukaMessages', 'grossRevenue', 'gmv', 'gmvCofunded'].includes(k)) continue
    const vals = sc.monthly.map(m => m.lines[k].value)
    if (vals.some(v => v == null) || sc.allTime.lines[k].value == null) continue
    const sum = vals.reduce((a, b) => a! + b!, 0)!
    const tol = LINE_BY_KEY[k].kind === 'money' ? 1 : 0
    if (Math.abs(sum - sc.allTime.lines[k].value!) > tol) f.push(`allTime.${k}=${sc.allTime.lines[k].value} but months sum to ${sum}`)
  }

  // Weekly and monthly from the same daily series must agree with it
  if (sc.daily) {
    const sumDays = (a: string, b: string, field: 'gmvMaxSpend' | 'gmvMaxRevenue' | 'views') => {
      let t = 0
      for (let d = a; d <= b; d = addDays(d, 1)) { const v = sc.daily![d]?.[field]; if (v == null) return null; t += v }
      return t
    }
    for (const p of [...sc.weekly, ...sc.monthly]) {
      for (const [field, cell] of [['gmvMaxSpend', p.lines.gmvMaxSpend.value], ['views', p.lines.views.value]] as const) {
        if (cell == null || p.lines[field].source !== 'euka') continue
        const s = sumDays(p.start, p.end, field)
        if (s == null) { w.push(`${p.key}: daily series incomplete for ${field}, cannot cross-check`); continue }
        if (Math.abs(s - cell) > (field === 'views' ? 0 : 0.05)) f.push(`${p.key}: ${field} ${cell} != sum of daily ${s}`)
      }
      if (p.gmvMaxRevenue != null) {
        const s = sumDays(p.start, p.end, 'gmvMaxRevenue')
        if (s != null && Math.abs(s - p.gmvMaxRevenue) > 0.05) f.push(`${p.key}: gmvMaxRevenue ${p.gmvMaxRevenue} != sum of daily ${s}`)
      }
    }
  }
  for (const i of sc.issues) if (i.severity === 'warn') w.push(i.text)
  return { status: f.length ? 'FAIL' : 'PASS', failures: f, warnings: w }
}
