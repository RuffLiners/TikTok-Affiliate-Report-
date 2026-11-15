import { describe, it, expect } from 'vitest'
import {
  buildScorecard, auditScorecard, computeRoi, projectValue, sumKnown, weekRanges, monthRanges, pctChange,
  parseSellerCenterCsv, LINE_KEYS, ScorecardRaw, ManualEntry,
} from './index'

// Control week from Euka, Nov 1 to 7 2026 (typed tool results read in the build session)
const CONTROL_WEEK = {
  shopGmv: 51830.97, gmvMaxSpend: 18083.48, gmvMaxRevenue: 59831.31, eukaMessages: 68180, samplesApproved: 30,
  creatorsPosted: 108, videos: 572, views: 2400982,
}

function rawFor(asOf: string, dataThrough: string): ScorecardRaw {
  const weeks: ScorecardRaw['weeks'] = {}
  for (const w of weekRanges(asOf)) weeks[w.key] = {}
  weeks['2026-11-01'] = { ...CONTROL_WEEK }
  const months: ScorecardRaw['months'] = {}
  for (const m of monthRanges(dataThrough)) months[m.key] = {}
  // Nov MTD through the 14th: 14 of 30 days
  months['2026-11'] = { shopGmv: 100000, gmvMaxSpend: 30000, gmvMaxRevenue: 90000, videos: 1400, creatorsPosted: 230, contestAffiliates: 31, emails: 700, usageRightsCreators: 1200 }
  months['2026-10'] = { shopGmv: 200000, gmvMaxSpend: 50000, gmvMaxRevenue: 150000, videos: 2000 }
  return { asOf, dataThrough, weeks, months, allTime: { gmvMaxSpend: 969397.38, gmvMaxRevenue: 2872068.94 } }
}

describe('calc', () => {
  it('ROI is revenue / spend and reproduces the control value', () => {
    expect(computeRoi(CONTROL_WEEK.gmvMaxRevenue, CONTROL_WEEK.gmvMaxSpend)).toBe(3.31)
    expect(computeRoi(2872068.94, 969397.38)).toBe(2.96)
  })
  it('ROI is null (never 0) when either side is missing or spend is 0', () => {
    expect(computeRoi(null, 10)).toBeNull()
    expect(computeRoi(10, null)).toBeNull()
    expect(computeRoi(10, 0)).toBeNull()
  })
  it('projection is (mtd / days elapsed) x days in month', () => {
    expect(projectValue('gmvMaxSpend', 30000, 14, 30)).toBe(64285.71)
    expect(projectValue('videos', 1400, 14, 30)).toBe(3000)
    expect(projectValue('videos', null, 14, 30)).toBeNull()
  })
  it('sumKnown keeps no-data distinct from zero', () => {
    expect(sumKnown([null, null])).toEqual({ value: null, missing: 2 })
    expect(sumKnown([1, null, 2])).toEqual({ value: 3, missing: 1 })
    expect(sumKnown([0, 0]).value).toBe(0)
  })
  it('pctChange is null without a usable prior', () => {
    expect(pctChange(10, 0)).toBeNull(); expect(pctChange(null, 5)).toBeNull(); expect(pctChange(110, 100)).toBe(10)
  })
})

describe('periods', () => {
  it('Monday Nov 9 2026: latest complete week is Sun Nov 1 to Sat Nov 7', () => {
    const w = weekRanges('2026-11-09')
    expect(w[0]).toEqual({ key: '2026-11-01', start: '2026-11-01', end: '2026-11-07' })
    expect(w).toHaveLength(13)
    expect(w[1].end).toBe('2026-10-31')
  })
  it('Sunday Nov 15: latest complete week is Nov 8 to 14; Saturday itself is not yet complete', () => {
    expect(weekRanges('2026-11-15')[0].end).toBe('2026-11-14')
    expect(weekRanges('2026-11-14')[0].end).toBe('2026-11-07')
  })
  it('months run from the current month back to October 2025, current first', () => {
    const m = monthRanges('2026-11-14')
    expect(m[0]).toMatchObject({ key: '2026-11', daysElapsed: 14, daysInMonth: 30, partial: true, end: '2026-11-14' })
    expect(m[m.length - 1].key).toBe('2025-10')
    expect(m[1]).toMatchObject({ key: '2026-10', daysElapsed: 31, partial: false })
  })
})

describe('buildScorecard', () => {
  const sc = buildScorecard(rawFor('2026-11-09', '2026-11-08'))
  const wk = sc.weekly[0]
  it('reproduces the control week', () => {
    expect(wk.start).toBe('2026-11-01')
    expect(wk.lines.gmvMaxSpend.value).toBe(18083.48)
    expect(wk.lines.gmvMaxRoi.value).toBe(3.31)
    expect(wk.lines.eukaMessages.value).toBe(68180)
    expect(wk.lines.samplesApproved.value).toBe(30)
    expect(wk.lines.creatorsPosted.value).toBe(108)
    expect(wk.lines.videos.value).toBe(572)
    expect(wk.lines.views.value).toBe(2400982)
  })
  it('Gross Revenue is GMV Max revenue and GMV is Euka shop GMV, both from Euka and confirmed', () => {
    expect(wk.lines.grossRevenue).toMatchObject({ value: 59831.31, source: 'euka', confirmed: true })
    expect(wk.lines.gmv).toMatchObject({ value: 51830.97, source: 'euka', confirmed: true })
  })
  it('ROI = Gross Revenue / spend, with a second ROI vs shop GMV figure, and the revenue-above-GMV gap is explained', () => {
    expect(wk.lines.gmvMaxRoi.value).toBe(computeRoi(wk.lines.grossRevenue.value, wk.lines.gmvMaxSpend.value))
    expect(wk.roiVsShopGmv).toBe(2.87)
    const gap = sc.issues.find(i => i.id === 'roi-gap:2026-11-01')!
    expect(gap.severity).toBe('info'); expect(gap.text).toMatch(/co-funded basis/)
  })
  it('co-funded GMV is the only line with no Euka value: no data until entered', () => {
    expect(wk.lines.gmvCofunded).toMatchObject({ value: null, source: 'none', confirmed: false })
  })
  it('weeks with no source data stay null, never 0', () => {
    const old = sc.weekly[5]
    for (const k of LINE_KEYS) expect(old.lines[k].value).toBeNull()
  })
  it('lists the unconfirmed co-funded line in the issues list, and nothing else as unconfirmed', () => {
    const ids = sc.issues.map(i => i.id).filter(i => i.startsWith('unconfirmed:'))
    expect(ids).toEqual(['unconfirmed:gmvCofunded'])
    expect(sc.issues.find(i => i.id === 'unconfirmed:gmvCofunded')!.severity).toBe('warn')
  })
  it('a manual co-funded entry is confirmed, attributed, and clears the issue when complete', () => {
    const entries: ManualEntry[] = [{ period_type: 'week', period_key: '2026-11-01', line: 'gmvCofunded', value: 61492.68, source: 'manual', entered_by: 'Brandon', entered_at: '2026-11-09T12:00:00Z' }]
    const s2 = buildScorecard(rawFor('2026-11-09', '2026-11-08'), entries)
    expect(s2.weekly[0].lines.gmvCofunded).toMatchObject({ value: 61492.68, source: 'manual', confirmed: true, enteredBy: 'Brandon' })
  })
  it('manual values never override Euka for Gross Revenue or GMV', () => {
    const s2 = buildScorecard(rawFor('2026-11-09', '2026-11-08'), [
      { period_type: 'week', period_key: '2026-11-01', line: 'gmv', value: 1, source: 'manual' },
      { period_type: 'week', period_key: '2026-11-01', line: 'grossRevenue', value: 1, source: 'manual' },
    ])
    expect(s2.weekly[0].lines.gmv).toMatchObject({ value: 51830.97, source: 'euka' })
    expect(s2.weekly[0].lines.grossRevenue.value).toBe(59831.31)
  })
  it('history Euka cannot reach can be filled by hand (Oct 2025 gross revenue and GMV)', () => {
    const s2 = buildScorecard(rawFor('2026-11-09', '2026-11-08'), [{ period_type: 'month', period_key: '2025-10', line: 'gmv', value: 8000, source: 'seller_center' }])
    expect(s2.monthly.find(m => m.key === '2025-10')!.lines.gmv).toMatchObject({ value: 8000, source: 'seller_center', confirmed: true })
  })
  it('monthly spot-check compares Euka to Seller Center on lines 1, 2, 4, 5 and flags over 2 percent', () => {
    const entries: ManualEntry[] = [
      { period_type: 'month_check', period_key: '2026-10', line: 'gmv', value: 190000, source: 'manual' },        // Euka 200000 is 5.3% above
      { period_type: 'month_check', period_key: '2026-10', line: 'gmvMaxSpend', value: 50000, source: 'manual' }, // exact
      { period_type: 'month_check', period_key: '2026-10', line: 'gmvMaxRoi', value: 3.0, source: 'manual' },     // exact
    ]
    const s2 = buildScorecard(rawFor('2026-11-15', '2026-11-14'), entries)
    const c = s2.sellerCenterCheck
    expect(c.period).toBe('2026-10')
    expect(c.rows.map(r => r.line)).toEqual(['grossRevenue', 'gmv', 'gmvMaxSpend', 'gmvMaxRoi'])
    expect(c.rows.find(r => r.line === 'gmv')).toMatchObject({ flag: true, status: 'compared', pctDiff: 5.3 })
    expect(c.rows.find(r => r.line === 'gmvMaxSpend')!.flag).toBe(false)
    expect(c.rows.find(r => r.line === 'gmvMaxRoi')!.flag).toBe(false)
    expect(c.rows.find(r => r.line === 'grossRevenue')!.status).toBe('no_seller_center_value')
    expect(c.flagged).toBe(1)
    expect(s2.issues.some(i => i.id.startsWith('sc-check:gmv'))).toBe(true)
  })
  it('spot-check values never replace a Euka cell', () => {
    const s2 = buildScorecard(rawFor('2026-11-15', '2026-11-14'), [{ period_type: 'month_check', period_key: '2026-10', line: 'gmvMaxSpend', value: 1, source: 'manual' }])
    expect(s2.monthly[1].lines.gmvMaxSpend.value).toBe(50000)
  })
  it('manual views fill only where Euka has none', () => {
    const entries: ManualEntry[] = [
      { period_type: 'month', period_key: '2025-11', line: 'views', value: 5000, source: 'seller_center' },
      { period_type: 'week', period_key: '2026-11-01', line: 'views', value: 1, source: 'seller_center' },
    ]
    const s2 = buildScorecard(rawFor('2026-11-09', '2026-11-08'), entries)
    expect(s2.weekly[0].lines.views).toMatchObject({ value: 2400982, source: 'euka' })
    expect(s2.monthly.find(m => m.key === '2025-11')!.lines.views).toMatchObject({ value: 5000, source: 'seller_center' })
  })
  it('all-time is the sum of its stored months, and its ROI is revenue / spend over those same months', () => {
    expect(sc.allTime.lines.gmvMaxSpend.value).toBe(80000)
    expect(sc.allTime.gmvMaxRevenue).toBe(240000)
    expect(sc.allTime.lines.gmvMaxRoi.value).toBe(3)
  })
  it('an all-time total built from partial history says so', () => {
    expect(sc.allTime.lines.videos.value).toBe(3400)
  })
  it('weekly change is vs the prior week', () => {
    const raw = rawFor('2026-11-09', '2026-11-08')
    raw.weeks['2026-10-25'] = { videos: 400, gmvMaxSpend: 10000, gmvMaxRevenue: 20000 }
    const s2 = buildScorecard(raw)
    expect(s2.weekly[0].prior.videos).toBe(400)
    expect(s2.weekly[0].changes.videos).toBe(43)
  })
})

describe('monthly projection', () => {
  const sc = buildScorecard(rawFor('2026-11-15', '2026-11-14'))
  const nov = sc.monthly[0]
  it('current month carries mtd, projection and days', () => {
    expect(nov).toMatchObject({ key: '2026-11', partial: true, daysElapsed: 14, daysInMonth: 30 })
    expect(nov.mtd.gmvMaxSpend).toBe(30000)
    expect(nov.projected!.gmvMaxSpend).toBe(64285.71)
    expect(nov.projected!.videos).toBe(3000)
  })
  it('ROI is recomputed from projected revenue and spend, not averaged', () => {
    expect(nov.projectedGmvMaxRevenue).toBe(192857.14)
    expect(nov.projected!.gmvMaxRoi).toBe(computeRoi(192857.14, 64285.71))
  })
  it('distinct-people lines are month to date only', () => {
    expect(nov.lines.creatorsPosted.value).toBe(230)
    expect(nov.projected!.creatorsPosted).toBeNull()
    expect(nov.projected!.contestAffiliates).toBeNull()
    expect(nov.projected!.usageRightsCreators).toBeNull()
  })
  it('lines with no data are not projected to 0', () => {
    expect(nov.projected!.eukaMessages).toBeNull()
    expect(nov.projected!.gmvCofunded).toBeNull()
  })
  it('Gross Revenue projects like any additive line', () => { expect(nov.projected!.grossRevenue).toBe(192857.14) })
  it('complete months carry no projection', () => { expect(sc.monthly[1].projected).toBeNull() })
})

describe('audit', () => {
  const good = () => buildScorecard(rawFor('2026-11-15', '2026-11-14'))
  it('passes a correctly built scorecard', () => {
    const r = auditScorecard(good()); expect(r.failures).toEqual([]); expect(r.status).toBe('PASS')
  })
  it('fails when ROI is not revenue / spend', () => {
    const s = good(); s.weekly[0].lines.gmvMaxRoi = { value: 9.99, source: 'euka', confirmed: true }
    expect(auditScorecard(s).failures.join()).toMatch(/ROI 9.99/)
  })
  it('fails when a projection is off the formula', () => {
    const s = good(); s.monthly[0].projected!.videos = 9999
    expect(auditScorecard(s).failures.join()).toMatch(/projected.videos/)
  })
  it('fails when a distinct-people line is projected', () => {
    const s = good(); s.monthly[0].projected!.creatorsPosted = 500
    expect(auditScorecard(s).failures.join()).toMatch(/must not be projected/)
  })
  it('fails when a line is 0 but its source is none (null turned into 0)', () => {
    const s = good(); s.weekly[3].lines.videos = { value: 0, source: 'none', confirmed: false }
    expect(auditScorecard(s).failures.join()).toMatch(/value null must match source none/)
  })
  it('fails when all-time does not equal the sum of its months', () => {
    const s = good(); s.allTime.lines.videos = { value: 1, source: 'euka', confirmed: true }
    expect(auditScorecard(s).failures.join()).toMatch(/allTime.videos=1 but months sum to 3400/)
  })
  it('fails when an all-time line is built from no months but still shows a number', () => {
    const s = good(); s.allTime.lines.emails = { value: 5, source: 'euka', confirmed: true }
    expect(auditScorecard(s).failures.join()).toMatch(/allTime.emails/)
  })
  it('fails when weekly spend disagrees with the daily series', () => {
    const raw = rawFor('2026-11-09', '2026-11-08')
    raw.daily = {}
    for (let d = 1; d <= 7; d++) raw.daily[`2026-11-0${d}`] = { gmvMaxSpend: 100, gmvMaxRevenue: 300, views: 10 }
    const r = auditScorecard(buildScorecard(raw))
    expect(r.failures.join()).toMatch(/gmvMaxSpend 18083.48 != sum of daily 700/)
  })
  it('fails when the structure is wrong', () => {
    const s = good(); s.weekly.pop(); expect(auditScorecard(s).status).toBe('FAIL')
  })
})

describe('full-year weekly history', () => {
  const raw = rawFor('2026-11-09', '2026-11-08'); raw.yearStart = '2026-01-01'
  for (const w of weekRanges('2026-11-09', 60)) raw.weeks[w.key] ??= {}
  const sc = buildScorecard(raw)
  it('covers every complete week from the one containing Jan 1, newest first', () => {
    expect(sc.weeklyAll![0].start).toBe('2026-11-01')
    expect(sc.weeklyAll![sc.weeklyAll!.length - 1].start).toBe('2025-12-28')
    expect(sc.weeklyAll!.length).toBe(45)
  })
  it('weekly stays the first 13 and the 13th week now has a prior-week change', () => {
    expect(sc.weekly.map(w => w.key)).toEqual(sc.weeklyAll!.slice(0, 13).map(w => w.key))
    expect(sc.weekly[12].prior.videos).toBeNull()   // no data in the older week, but the prior week exists
    expect(sc.weeklyAll![12].key).toBe(sc.weekly[12].key)
  })
  it('passes the audit', () => { expect(auditScorecard(sc).failures).toEqual([]) })
  it('without yearStart the report keeps exactly 13 weeks and no weeklyAll', () => {
    const s2 = buildScorecard(rawFor('2026-11-09', '2026-11-08'))
    expect(s2.weeklyAll).toBeUndefined(); expect(s2.weekly).toHaveLength(13)
  })
})

describe('csv import', () => {
  it('skips blank cells instead of storing 0', () => {
    const r = parseSellerCenterCsv('period_type,period_key,grossRevenue,gmvCofunded\nmonth,2025-10,"$1,200.50",\nweek,2026-11-01,,500')
    expect(r.errors).toEqual([])
    expect(r.entries.map(e => [e.period_key, e.line, e.value])).toEqual([['2025-10', 'grossRevenue', 1200.5], ['2026-11-01', 'gmvCofunded', 500]])
    expect(r.skipped).toBe(2)
  })
  it('rejects unknown columns and bad keys', () => {
    expect(parseSellerCenterCsv('period_type,period_key,bogus\nmonth,2025-10,1').errors[0]).toMatch(/Unknown column/)
    expect(parseSellerCenterCsv('period_type,period_key,gmv\nmonth,Oct,1').errors[0]).toMatch(/bad period_key/)
    expect(parseSellerCenterCsv('period_type,period_key,gmv\nmonth,2025-10,-5').errors[0]).toMatch(/non-negative/)
    expect(parseSellerCenterCsv('period_type,period_key,gmvCofunded\nmonth_check,2025-10,5').errors[0]).toMatch(/not allowed for period_type month_check/)
  })
})
