import {
  ADDITIVE_KEYS, AllTimePeriod, Cell, Issue, LINES, LINE_BY_KEY, LineKey, Lines, LINE_KEYS,
  ManualEntry, MonthPeriod, ScorecardRaw, RangeRaw, Scorecard, SellerCenterCheckRow, WeekPeriod, SELLER_CENTER_KEYS,
} from './types'
import { computeRoi, pctChange, projectValue, round2, roundFor, sumKnown } from './calc'
import { monthRanges, weekRanges } from './periods'

export const CHECK_THRESHOLD_PCT = 2

const none = (note?: string): Cell => ({ value: null, source: 'none', confirmed: false, ...(note ? { note } : {}) })
const eukaCell = (v: number | null | undefined): Cell =>
  v == null ? none('No data') : { value: v, source: 'euka', confirmed: true }

type ManualMap = Map<string, ManualEntry>
const mk = (t: string, k: string, line: LineKey) => `${t}|${k}|${line}`
export function indexManual(entries: ManualEntry[]): ManualMap {
  return new Map(entries.map(e => [mk(e.period_type, e.period_key, e.line), e]))
}
function manualCell(e: ManualEntry): Cell {
  return {
    value: e.value, source: e.source, confirmed: true,
    ...(e.entered_by ? { enteredBy: e.entered_by } : {}), ...(e.entered_at ? { enteredAt: e.entered_at } : {}),
  }
}

/** The 14 cells for one week or month (month to date for the current month). */
function resolveLines(type: 'week' | 'month', key: string, raw: RangeRaw, manual: ManualMap): { lines: Lines; revenue: number | null } {
  const m = (line: LineKey) => manual.get(mk(type, key, line))
  const L = {} as Lines
  L.gmvMaxSpend = eukaCell(raw.gmvMaxSpend)
  L.targetInvites = eukaCell(raw.targetInvites)
  L.emails = eukaCell(raw.emails)
  L.samplesApproved = eukaCell(raw.samplesApproved)
  L.creatorsPosted = eukaCell(raw.creatorsPosted)
  L.videos = eukaCell(raw.videos)
  L.contestAffiliates = eukaCell(raw.contestAffiliates)
  L.usageRightsCreators = eukaCell(raw.usageRightsCreators)
  // Euka first. A person fills only where Euka has no history (before its retention window).
  const eukaVal: Partial<Record<LineKey, number | null | undefined>> = {
    grossRevenue: raw.gmvMaxRevenue, gmv: raw.shopGmv, views: raw.views, eukaMessages: raw.eukaMessages,
  }
  for (const k of ['grossRevenue', 'gmv', 'views', 'eukaMessages'] as const) {
    const me = m(k)
    L[k] = eukaVal[k] != null ? eukaCell(eukaVal[k]) : me ? manualCell(me) : none('No data')
  }
  // The only line with no Euka source: Seller Center "Gross merchandise value (with TikTok co-funding)"
  const cf = m('gmvCofunded')
  L.gmvCofunded = cf ? manualCell(cf) : none('Not yet entered (Seller Center)')
  // ROI = Gross Revenue / GMV Max spend
  const roi = computeRoi(L.grossRevenue.value, raw.gmvMaxSpend)
  L.gmvMaxRoi = roi == null ? none('No data') : { value: roi, source: 'euka', confirmed: true }
  return { lines: L, revenue: L.grossRevenue.value }
}

const roiVs = (l: Lines) => computeRoi(l.gmv.value, l.gmvMaxSpend.value)
const valuesOf = (l: Lines) => Object.fromEntries(LINE_KEYS.map(k => [k, l[k].value])) as Record<LineKey, number | null>

export function buildScorecard(raw: ScorecardRaw, manualEntries: ManualEntry[] = []): Scorecard {
  const manual = indexManual(manualEntries)
  const mRanges = monthRanges(raw.dataThrough)
  const wRanges = weekRanges(raw.asOf, 13)

  const monthly: MonthPeriod[] = mRanges.map(r => {
    const rr = raw.months[r.key] ?? {}
    const { lines, revenue } = resolveLines('month', r.key, rr, manual)
    const mtd = valuesOf(lines)
    let projected: MonthPeriod['projected'] = null
    let projRev: number | null = null
    let projRoiVs: number | null = null
    if (r.partial) {
      projected = {} as Record<LineKey, number | null>
      for (const k of LINE_KEYS) projected[k] = null
      for (const k of ADDITIVE_KEYS) projected[k] = projectValue(k, mtd[k], r.daysElapsed, r.daysInMonth)
      projRev = projected.grossRevenue
      // Rates come from projected numerator and denominator, never averaged
      projected.gmvMaxRoi = computeRoi(projRev, projected.gmvMaxSpend)
      projRoiVs = computeRoi(projected.gmv, projected.gmvMaxSpend)
    }
    return {
      key: r.key, label: r.key, start: r.start, end: r.end, lines, gmvMaxRevenue: revenue, roiVsShopGmv: roiVs(lines),
      partial: r.partial, daysElapsed: r.daysElapsed, daysInMonth: r.daysInMonth, mtd,
      projected, projectedGmvMaxRevenue: projRev, projectedRoiVsShopGmv: projRoiVs,
    }
  })

  const weeklyBase = wRanges.map(r => {
    const { lines, revenue } = resolveLines('week', r.key, raw.weeks[r.key] ?? {}, manual)
    return { r, lines, revenue }
  })
  const weekly: WeekPeriod[] = weeklyBase.map((w, i) => {
    const prev = weeklyBase[i + 1]
    const prior = Object.fromEntries(LINE_KEYS.map(k => [k, prev ? prev.lines[k].value : null])) as Record<LineKey, number | null>
    const changes = Object.fromEntries(LINE_KEYS.map(k => [k, pctChange(w.lines[k].value, prior[k])])) as Record<LineKey, number | null>
    return {
      key: w.r.key, label: `${w.r.start} to ${w.r.end}`, start: w.r.start, end: w.r.end,
      lines: w.lines, gmvMaxRevenue: w.revenue, roiVsShopGmv: roiVs(w.lines), prior, changes,
    }
  })

  // All time. Lines that can be filled by hand sum their monthly cells, so Euka months and filled history add up
  // consistently. Distinct-people lines come straight from the all-time pull and are never summed.
  // ROI uses the Euka all-time revenue and spend only, so both sides cover the same window.
  const atRaw = raw.allTime
  const { lines: atLines } = resolveLines('month', '__all__', atRaw, new Map())
  const summed: LineKey[] = ['grossRevenue', 'gmv', 'gmvCofunded', 'views', 'eukaMessages']
  for (const k of summed) {
    const cells = monthly.map(m => m.lines[k])
    const { value, missing } = sumKnown(cells.map(c => c.value))
    if (value == null) { atLines[k] = none(k === 'gmvCofunded' ? 'Not yet entered (Seller Center)' : 'No data'); continue }
    const allConfirmed = cells.every(c => c.confirmed)
    const anyManual = cells.some(c => c.source === 'manual' || c.source === 'seller_center')
    atLines[k] = {
      value: roundFor(k, value),
      source: anyManual ? (cells.some(c => c.source === 'manual') ? 'manual' : 'seller_center') : 'euka',
      confirmed: allConfirmed && missing === 0,
      note: missing ? `Partial: ${missing} of ${cells.length} months have no data` : undefined,
    }
  }
  const atRev = atRaw.gmvMaxRevenue ?? null
  const allTime: AllTimePeriod = {
    key: 'all-time', label: 'All time since launch', start: '2025-10-01', end: raw.dataThrough,
    lines: atLines, gmvMaxRevenue: atRev, roiVsShopGmv: roiVs(atLines),
  }

  const sellerCenterCheck = buildCheck(raw, manual, monthly)
  const sc: Scorecard = {
    version: 1, asOf: raw.asOf, dataThrough: raw.dataThrough, allTime, weekly, monthly,
    issues: [], sellerCenterCheck, ...(raw.daily ? { daily: raw.daily } : {}),
  }
  sc.issues = [...buildIssues(sc), ...(raw.notes ?? []).map((text, i) => ({ id: `note:${i}`, severity: 'info' as const, text }))]
  return sc
}

function checkRow(line: SellerCenterCheckRow['line'], period: string, euka: number | null, scv: number | null): SellerCenterCheckRow {
  if (scv == null) return { line, period, euka, sellerCenter: null, diff: null, pctDiff: null, flag: false, status: 'no_seller_center_value' }
  if (euka == null) return { line, period, euka: null, sellerCenter: scv, diff: null, pctDiff: null, flag: false, status: 'no_euka_value' }
  const diff = round2(euka - scv)
  const pctDiff = scv === 0 ? null : Math.round((diff / Math.abs(scv)) * 1000) / 10
  return { line, period, euka, sellerCenter: scv, diff, pctDiff, flag: pctDiff != null && Math.abs(pctDiff) > CHECK_THRESHOLD_PCT, status: 'compared' }
}

/** Monthly spot-check: Euka vs Seller Center for the latest complete month, on Gross Revenue, GMV, GMV Max spend and ROI. */
function buildCheck(raw: ScorecardRaw, manual: ManualMap, monthly: MonthPeriod[]): Scorecard['sellerCenterCheck'] {
  const rows: SellerCenterCheckRow[] = []
  const done = monthly.find(m => !m.partial) ?? monthly[0]
  const rr = raw.months[done.key] ?? {}
  const sv = (line: LineKey) => manual.get(mk('month_check', done.key, line))?.value ?? null
  rows.push(checkRow('grossRevenue', done.key, rr.gmvMaxRevenue ?? null, sv('grossRevenue')))
  rows.push(checkRow('gmv', done.key, rr.shopGmv ?? null, sv('gmv')))
  rows.push(checkRow('gmvMaxSpend', done.key, rr.gmvMaxSpend ?? null, sv('gmvMaxSpend')))
  rows.push(checkRow('gmvMaxRoi', done.key, computeRoi(rr.gmvMaxRevenue, rr.gmvMaxSpend), sv('gmvMaxRoi')))
  return { period: done.key, thresholdPct: CHECK_THRESHOLD_PCT, rows, flagged: rows.filter(r => r.flag).length }
}

export function buildIssues(sc: Scorecard): Issue[] {
  const issues: Issue[] = []
  const w0 = sc.weekly[0], m0 = sc.monthly[0]
  for (const k of SELLER_CENTER_KEYS) {
    const def = LINE_BY_KEY[k]
    const wMiss = sc.weekly.filter(w => !w.lines[k].confirmed)
    const mMiss = sc.monthly.filter(m => !m.lines[k].confirmed)
    if (!wMiss.length && !mMiss.length) continue
    const latestMissing = !w0.lines[k].confirmed || !m0.lines[k].confirmed
    const euk = ''
    issues.push({
      id: `unconfirmed:${k}`, severity: latestMissing ? 'warn' : 'info', line: k,
      text: `${def.label}: not yet entered from Seller Center for ${wMiss.length} of ${sc.weekly.length} weeks and ${mMiss.length} of ${sc.monthly.length} months. Latest week ${w0.key}: ${w0.lines[k].confirmed ? 'confirmed' : 'missing'}. ${m0.key}: ${m0.lines[k].confirmed ? 'confirmed' : 'missing'}.${euk}`,
    })
  }
  for (const p of [w0, m0]) {
    if (p.gmvMaxRevenue != null && p.lines.gmv.value != null && p.gmvMaxRevenue > p.lines.gmv.value) {
      issues.push({
        id: `roi-gap:${p.key}`, severity: 'info', line: 'gmvMaxRoi',
        text: `${p.key}: Gross Revenue ($${p.gmvMaxRevenue.toFixed(2)}) is above shop GMV ($${p.lines.gmv.value.toFixed(2)}) because it is on TikTok's co-funded basis. ROI is ${p.lines.gmvMaxRoi.value}; ROI vs shop GMV is ${p.roiVsShopGmv ?? 'n/a'}.`,
      })
    }
  }
  const nulls = LINES.filter(l => w0.lines[l.key].value == null && !SELLER_CENTER_KEYS.includes(l.key))
  if (nulls.length) {
    issues.push({ id: 'no-data:latest-week', severity: 'warn', text: `No data for the latest week (${w0.key}): ${nulls.map(l => l.label).join('; ')}.` })
  }
  const flagged = sc.sellerCenterCheck.rows.filter(r => r.flag)
  for (const r of flagged) {
    issues.push({ id: `sc-check:${r.line}:${r.period}`, severity: 'warn', line: r.line, text: `Seller Center spot-check, ${r.period}, ${r.line}: Euka ${r.euka} vs Seller Center ${r.sellerCenter} (${r.pctDiff}% apart, limit ${sc.sellerCenterCheck.thresholdPct}%).` })
  }
  return issues
}

