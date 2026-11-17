// Weekly report data pulled straight from Euka's typed tools: no model in the loop, so the same call always gives
// the same number and costs no tokens. It fills the same `pd` keys the existing assembly, validation and analysis
// steps read (A1..A6, C1, C3, C4, D1, D3), so nothing downstream changes. Anything Euka cannot serve directly is left
// null and listed in `gaps`; it is never filled with a guess or a zero.
import { format } from 'date-fns'
import type { EukaLike } from '@/lib/scorecard/engine'
import { BRAND_ID, EUKA_CONCURRENCY, mapPool } from '@/lib/scorecard/engine'
import { addDays } from '@/lib/scorecard'
import type { buildWindows } from '@/lib/assembleReport'

type W = ReturnType<typeof buildWindows>
type Range = { start: string; end: string }
const f = (d: Date) => format(d, 'yyyy-MM-dd')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const r2 = (n: number) => Math.round(n * 100) / 100
const LV = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'] as const

export interface ReportGroup1 {
  pd: Record<string, any>
  /** What each key was built from, in words a reviewer can check. */
  sources: Record<string, string>
  /** Fields the old prompts asked for that Euka has no direct source for. Left null. */
  gaps: string[]
  calls: number
  ms: number
}

/** Daily affiliate GMV, orders, videos and outreach for a span, in 31-day pieces. Days Euka omits stay missing. */
async function dailySeries(e: EukaLike, from: string, to: string) {
  const parts: Array<[string, string]> = []
  for (let s = from; s <= to; s = addDays(s, 31)) { const x = addDays(s, 30); parts.push([s, x > to ? to : x]) }
  const res = await mapPool(parts, EUKA_CONCURRENCY, ([a, b]) => e.call('get_dashboard_performance_series', { brandId: BRAND_ID, startDate: a, endDate: b }))
  const day: Record<string, { gmv?: number; orders?: number; videos?: number; msgs?: number; shipped?: number }> = {}
  const put = (d: string, k: 'gmv' | 'orders' | 'videos' | 'msgs' | 'shipped', v: unknown) => { const n = num(v); if (n !== null && d) (day[d] ??= {})[k] = n }
  for (const r of res) {
    for (const x of r?.data?.performances ?? []) { put(x.date, 'gmv', x.total_gmv); put(x.date, 'orders', x.total_orders) }
    for (const x of r?.data?.videoPosted ?? []) put(x.date, 'videos', x.videos_posted)
    for (const x of r?.data?.analyticsAggregated ?? []) { put(x.date, 'msgs', x.messages_sent); put(x.date, 'shipped', x.samples_shipped) }
  }
  return day
}
/** Sum over a range. null when any day is missing: a partial sum would understate the period. */
function sum(day: Awaited<ReturnType<typeof dailySeries>>, r: Range, k: 'gmv' | 'orders' | 'videos' | 'msgs' | 'shipped'): number | null {
  let t = 0
  for (let d = r.start; d <= r.end; d = addDays(d, 1)) { const v = day[d]?.[k]; if (v === undefined) return null; t += v }
  return r2(t)
}

export async function collectReportGroup1(euka: EukaLike, w: W): Promise<ReportGroup1> {
  const t0 = Date.now()
  let calls = 0
  const e: EukaLike = { call: (n, a) => { calls++; return euka.call(n, a) } }
  const weeks: Range[] = w.weeks.map(x => ({ start: f(x.start), end: f(x.end) }))
  // The current month ends at the last finalized day (the 30-day window end), like the old prompt's "MTD" intent, never in the future
  const months: Array<Range & { key: string }> = w.months.map((m: any, i: number) => ({ key: m.key, start: f(m.start), end: i === w.months.length - 1 ? (w.d30.end < f(m.start) ? f(m.start) : w.d30.end) : f(m.end) }))
  const overview = (r: Range, compare = false) => e.call('get_dashboard_performance_overview', { brandId: BRAND_ID, startDate: r.start, endDate: r.end, compareTo: compare ? { type: 'previous_period' } : { type: 'none' } })
  const retention = (r: Range, prev: Range) => e.call('get_creator_retention_summary', { brandId: BRAND_ID, startDate: r.start, endDate: r.end, compareTo: { type: 'custom', startDate: prev.start, endDate: prev.end } })
  const prevWeek = (r: Range): Range => ({ start: addDays(r.start, -7), end: addDays(r.end, -7) })
  const prevMonth = (r: Range): Range => { const end = addDays(r.start, -1); return { start: `${end.slice(0, 7)}-01`, end } }

  const spanFrom = [w.prior.start, weeks[0].start, months[0].start].sort()[0]
  const spanTo = [w.d30.end, weeks[weeks.length - 1].end, months[months.length - 1].end].sort().pop()!
  const [day, ovCur, ovPrior, ret30, tiers, tiersPrior, ads, weekOv, weekRet, monthOv, monthRet] = await Promise.all([
    dailySeries(e, spanFrom, spanTo),
    overview(w.d30, true), overview(w.prior),
    retention(w.d30, w.prior),
    e.call('get_dashboard_creator_level_breakdown', { brandId: BRAND_ID, postedDateRange: { startDate: w.d30.start, endDate: w.d30.end } }),
    e.call('get_dashboard_creator_level_breakdown', { brandId: BRAND_ID, postedDateRange: { startDate: w.prior.start, endDate: w.prior.end } }),
    e.call('get_dashboard_ads_overview', { brandId: BRAND_ID, postedDateRange: { startDate: w.d30.start, endDate: w.d30.end }, compareTo: { type: 'none' } }),
    mapPool(weeks, EUKA_CONCURRENCY, r => overview(r)),
    mapPool(weeks, EUKA_CONCURRENCY, r => retention(r, prevWeek(r))),
    mapPool(months, EUKA_CONCURRENCY, r => overview(r)),
    mapPool(months, EUKA_CONCURRENCY, r => retention(r, prevMonth(r))),
  ])

  // Shop GMV is only trusted when Euka says the figure is whole (the old prompt's guardrail)
  const shopOk = (o: any) => o?.shopGmvError == null && o?.gmvFiltered === false && o?.filteredGmvUnavailable === false && !o?.performanceRangeCoverage?.isTruncated
  const pctRate = (v: unknown) => { const n = num(v); return n === null ? null : Math.round(n * 1000) / 10 }
  const kpi = (r: Range, ov: any, rs: any) => ({
    gmv: sum(day, r, 'gmv'), orders: sum(day, r, 'orders'),
    videos: num(rs?.totalVideos), views: num(ov?.impressions),
    creators: num(rs?.activeCreators), newCreators: num(rs?.newCreators), retention: pctRate(rs?.retentionRate),
  })
  const A1 = {
    ...kpi(w.d30, ovCur, ret30?.current),
    shopGmv: shopOk(ovCur) ? num(ovCur?.totalShopGMV) : null, shopGmvPct: shopOk(ovCur) ? num(ovCur?.totalShopGMVDifference) : null,
    affiliateGmv: shopOk(ovCur) ? num(ovCur?.totalAffiliateGMV) : null, affiliateGmvPct: shopOk(ovCur) ? num(ovCur?.totalAffiliateGMVDifference) : null,
  }
  const A2 = kpi(w.prior, ovPrior, ret30?.previous)

  const tierRow = (list: any, lk: string) => (list?.tiers ?? []).find((t: any) => String(t.tier).toLowerCase() === lk)
  const A3 = Object.fromEntries(LV.map(lk => { const t = tierRow(tiers, lk); return [lk, { creators: num(t?.activeCreators), newCreators: null, videos: num(t?.videos), views: null, gmv: t ? r2(Number(t.totalGmv) || 0) : null }] }))
  const outreach = (list: any, r: Range) => ({
    total: { msgs: sum(day, r, 'msgs'), samples: sum(day, r, 'shipped') },
    ...Object.fromEntries(LV.map(lk => { const t = tierRow(list, lk); return [lk, { msgs: null, invites: num(t?.invitesSent), samples: num(t?.samplesDelivered), approved: num(t?.samplesApproved) }] })),
  })
  const A4 = outreach(tiers, w.d30), A5 = outreach(tiersPrior, w.prior)
  const k = ads?.adKpis ?? {}
  const spend = num(k.currentSpend), revenue = num(k.currentRevenue)
  const A6 = { spend, revenue, roi: spend && revenue != null && spend > 0 ? r2(revenue / spend) : null, ...Object.fromEntries(LV.map(lk => [lk, { spend: null, roi: null }])) }

  const C1 = weeks.map(r => ({ gmv: sum(day, r, 'gmv'), orders: sum(day, r, 'orders') }))
  const C3 = weekRet.map((x: any) => pctRate(x?.current?.retentionRate))
  const C4 = weeks.map((r, i) => ({ videos: num(weekRet[i]?.current?.totalVideos), views: num(weekOv[i]?.impressions) }))
  const D1 = months.map((r, i) => ({ gmv: sum(day, r, 'gmv'), shopGmv: shopOk(monthOv[i]) ? num(monthOv[i]?.totalShopGMV) : null, views: num(monthOv[i]?.impressions) }))
  const D3 = monthRet.map((x: any) => pctRate(x?.current?.retentionRate))

  return {
    pd: { A1, A2, A3, A4, A5, A6, C1, C3, C4, D1, D3, _weekly: weekRet.map((x: any, i: number) => ({ week: weeks[i].start, creators: num(x?.current?.activeCreators), newCreators: num(x?.current?.newCreators) })), _windows: { d30: w.d30, prior: w.prior, weeks, months } },
    sources: {
      'gmv, orders (A1, A2, C1, D1)': 'get_dashboard_performance_series performances[].total_gmv / total_orders, summed by day. A period with a missing day is null.',
      'shopGmv, affiliateGmv and their % change': 'get_dashboard_performance_overview totalShopGMV / totalAffiliateGMV and their Difference fields (vs the preceding equal period). null when Euka flags the figure as filtered, errored or cut short by retention.',
      views: 'get_dashboard_performance_overview.impressions for the exact window (affiliate shoppable-video impressions).',
      'creators, newCreators, retention, videos': 'get_creator_retention_summary for the exact window: activeCreators (posted in the window), newCreators, retentionRate x 100, totalVideos. Prior window from the same call.',
      'A3 tiers': 'get_dashboard_creator_level_breakdown: activeCreators, videos, totalGmv per L1 to L7. Levels are each creator\'s CURRENT 30-day platform GMV tier.',
      'A4, A5 outreach': 'totals: series messages_sent (follow-ups are a separate field and excluded) and samples_shipped. Per tier: invitesSent, samplesDelivered, samplesApproved from the tier breakdown.',
      A6: 'get_dashboard_ads_overview adKpis currentSpend / currentRevenue; ROI = revenue / spend.',
      'C3, D3 retention': 'get_creator_retention_summary per Sun to Sat week (vs the prior week) and per calendar month (vs the prior month).',
    },
    gaps: [
      'A3: views per tier and new creators per tier (Euka\'s tier breakdown does not return them).',
      'A4/A5: outreach MESSAGES per tier (Euka returns Target Collab invites per tier, not messages). Total messages are available.',
      'A6: GMV Max spend and ROI per tier (Euka reports GMV Max per creative, not per creator tier).',
      'Tier definition differs from the old prompt: Euka uses the creator\'s current tier, the old prompt joined gmv_30d at query time. Same thresholds.',
    ],
    calls, ms: Date.now() - t0,
  }
}
