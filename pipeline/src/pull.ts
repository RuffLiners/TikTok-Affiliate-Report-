// Euka pulls for the scorecard, on typed tools only. Every Euka result is cached by report date and step so a failed run resumes.
import { Euka, BRAND_ID } from './euka.js'
import { cached } from './cache.js'
import {
  ScorecardRaw, RangeRaw, weekRanges, monthRanges, addDays, monthOf, LAUNCH_DATE, computeRoi, round2,
} from '../../tiktok-dashboard/src/lib/scorecard/index'
import { DailyMap, mergeAds, mergeSeries, sumRange, chunks, snapshotOnOrAfter } from './daily.js'

export const ADS_HISTORY_FROM = '2025-10-28'
/** Euka returns 0 for views before this; that is "no data", not zero. */
export const VIEWS_FROM = '2026-01-01'
const nz = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export interface Overview { shopGmv: number | null; messages: number | null; samplesApproved: number | null; creatorsPosted: number | null; videos: number | null; views: number | null; truncated: boolean }

/** Range-level performance overview. A truncated range (outside TikTok's retention) yields nulls, never partial numbers. */
export async function pullOverview(e: Euka, asOf: string, a: string, b: string): Promise<Overview> {
  const r = await cached(asOf, `overview_${a}_${b}`, async () => {
    try { return await e.call('get_dashboard_performance_overview', { brandId: BRAND_ID, startDate: a, endDate: b, compareTo: { type: 'none' } }) }
    catch (err) { return { _error: String((err as Error).message).slice(0, 200) } }
  })
  const truncated = !!r?.performanceRangeCoverage?.isTruncated
  const perf = (v: any) => (truncated || r?._error ? null : nz(v))
  return {
    shopGmv: perf(r?.totalShopGMV), messages: perf(r?.messagesSent), samplesApproved: perf(r?.samplesApproved),
    creatorsPosted: perf(r?.activeCreators), videos: perf(r?.videoConvRateTotalVideos),
    views: b < VIEWS_FROM || r?._error ? null : nz(r?.allAccountVideoViews), truncated,
  }
}

export async function pullAds(e: Euka, asOf: string, a: string, b: string) {
  const r = await cached(asOf, `ads_${a}_${b}`, () => e.call('get_dashboard_ads_overview', { brandId: BRAND_ID, postedDateRange: { startDate: a, endDate: b }, compareTo: { type: 'none' } }))
  const k = r?.adKpis ?? {}
  return { spend: nz(k.currentSpend), revenue: nz(k.currentRevenue), roas: nz(k.currentRoas), orders: nz(k.currentOrders) }
}

/** Daily series for the whole span, in 31-day chunks. */
export async function pullDaily(e: Euka, asOf: string, from: string, to: string): Promise<DailyMap> {
  const daily: DailyMap = {}
  for (const [a, b] of chunks(from, to, 31)) {
    const series = await cached(asOf, `series_${a}_${b}`, () => e.call('get_dashboard_performance_series', { brandId: BRAND_ID, startDate: a, endDate: b }))
    mergeSeries(daily, series)
    const ads = await cached(asOf, `adsdaily_${a}_${b}`, () => e.call('get_dashboard_ads_overview', { brandId: BRAND_ID, postedDateRange: { startDate: a, endDate: b }, compareTo: { type: 'none' } }))
    mergeAds(daily, ads)
  }
  return daily
}

/** Distinct creators per calendar month across that month's contests (contests only; Retainers excluded). */
export async function pullContests(e: Euka, asOf: string): Promise<{ byMonth: Record<string, number>; firstMonth: string | null; allTime: number }> {
  const list = await cached(asOf, 'contests', () => e.call('list_contests', { brandId: BRAND_ID, limit: 100, offset: 0 }))
  const contests = (list?.contests ?? []).filter((c: any) => c.type !== 'retainer' && c.status !== 'canceled')
  const byMonthSet: Record<string, Set<string>> = {}, all = new Set<string>()
  for (const c of contests) {
    const ids: string[] = await cached(asOf, `contest_${c.id}`, async () => {
      const out: string[] = []
      for (let offset = 0; ; offset += 100) {
        const r = await e.call('get_contest', { brandId: BRAND_ID, contestId: String(c.id), limit: 100, offset })
        for (const p of r?.participants ?? []) out.push(String(p.creatorId))
        if (!r?.pagination?.hasMoreParticipants) break
      }
      return out
    })
    const m = monthOf(c.startDate)
    const set = (byMonthSet[m] ??= new Set<string>())
    for (const id of ids) { set.add(id); all.add(id) }
  }
  const months = Object.keys(byMonthSet).sort()
  return { byMonth: Object.fromEntries(months.map(m => [m, byMonthSet[m].size])), firstMonth: months[0] ?? null, allTime: all.size }
}

/** Distinct creators with active usage rights right now. Euka has no dated source, so history comes from daily snapshots. */
export async function pullUsageRightsNow(e: Euka, asOf: string): Promise<number> {
  const ids = await cached(asOf, 'usage_rights_creators', async () => {
    const set = new Set<string>()
    for (let page = 1; ; page++) {
      const r = await e.call('search_usage_rights_requests', { brandId: BRAND_ID, filter: { archived: 'include', states: ['active'] }, page, pageSize: 100 })
      for (const it of r?.items ?? []) if (it?.creator?.id) set.add(String(it.creator.id))
      if (!r?.items?.length || page * 100 >= (r?.total ?? 0)) break
    }
    return [...set]
  })
  return ids.length
}

export interface PullResult { raw: ScorecardRaw; gaps: string[]; usageNow: number }

export async function pullScorecardRaw(e: Euka, asOf: string, dataThrough: string, usageSnaps: Array<{ snap_date: string; value: number }>): Promise<PullResult> {
  const gaps: string[] = []
  const daily = await pullDaily(e, asOf, LAUNCH_DATE, dataThrough)
  const contests = await pullContests(e, asOf)
  const usageNow = await pullUsageRightsNow(e, asOf)
  const contestFor = (month: string) => (contests.firstMonth && month >= contests.firstMonth ? contests.byMonth[month] ?? 0 : null)
  const ads = { historyFrom: ADS_HISTORY_FROM }

  async function range(a: string, b: string, usageEnd: string | null): Promise<RangeRaw> {
    const ov = await pullOverview(e, asOf, a, b)
    return {
      shopGmv: sumRange(daily, a, b, 'shopGmv', {}, gaps),
      gmvMaxSpend: sumRange(daily, a, b, 'spend', ads, gaps),
      gmvMaxRevenue: sumRange(daily, a, b, 'revenue', ads, gaps),
      targetInvites: sumRange(daily, a, b, 'invites', {}, gaps),
      emails: sumRange(daily, a, b, 'emails', {}, gaps),
      eukaMessages: sumRange(daily, a, b, 'messages', {}, gaps),
      videos: sumRange(daily, a, b, 'videos', {}, gaps),
      samplesApproved: ov.samplesApproved, creatorsPosted: ov.creatorsPosted, views: ov.views,
      contestAffiliates: contestFor(monthOf(b)),
      usageRightsCreators: usageEnd == null ? null : usageEnd === 'now' ? usageNow : snapshotOnOrAfter(usageSnaps, addDays(usageEnd, 1)),
    }
  }
  const weeks: ScorecardRaw['weeks'] = {}, months: ScorecardRaw['months'] = {}
  for (const w of weekRanges(asOf, 13)) weeks[w.key] = await range(w.start, w.end, w.end === weekRanges(asOf, 1)[0].end ? 'now' : w.end)
  const mr = monthRanges(dataThrough)
  for (const m of mr) months[m.key] = await range(m.start, m.end, m.partial ? 'now' : m.end)
  const all = await range(LAUNCH_DATE, dataThrough, 'now')
  all.creatorsPosted = (await pullOverview(e, asOf, LAUNCH_DATE, dataThrough)).creatorsPosted
  all.contestAffiliates = contests.allTime || null
  // For all-time, spend and revenue are the full daily sums so ROI covers one window
  const rawDaily: NonNullable<ScorecardRaw['daily']> = {}
  for (let d = addDays(dataThrough, -400); d <= dataThrough; d = addDays(d, 1)) {
    const x = daily[d]; if (x && (x.spend !== undefined || x.revenue !== undefined)) rawDaily[d] = { gmvMaxSpend: x.spend ?? null, gmvMaxRevenue: x.revenue ?? null }
  }
  const notes = [
    'Videos, messages, Target Collab invites and emails come from the daily series of get_dashboard_performance_series; a period with any missing day shows no data rather than a partial sum.',
    'Affiliates with usage rights are distinct creators with an active request. Euka has no dated source, so history before the first daily snapshot shows no data.',
    'Euka reports views as 0 before 2026-01-01; those periods show no data.',
  ]
  return { raw: { asOf, dataThrough, weeks, months, allTime: all, daily: rawDaily, notes }, gaps, usageNow }
}

/** Independent range-level controls for the Python audit (overview + ads overview, not the daily series). */
export async function buildControls(e: Euka, asOf: string, dataThrough: string): Promise<any> {
  const ranges: Record<string, any> = {}, roi: Record<string, number> = {}, roiVs: Record<string, number> = {}
  const targets: Array<[string, string, string]> = [
    ...weekRanges(asOf, 4).map(w => [`week:${w.key}`, w.start, w.end] as [string, string, string]),
    ...monthRanges(dataThrough).slice(0, 2).map(m => [`month:${m.key}`, m.start, m.end] as [string, string, string]),
    ['month:2025-10', '2025-10-01', '2025-10-31'],
  ]
  for (const [name, a, b] of targets) {
    const ov = await pullOverview(e, asOf, a, b)
    const ad = await pullAds(e, asOf, a, b)
    const hasAds = b >= ADS_HISTORY_FROM
    ranges[name] = {
      shopGmv: ov.shopGmv, eukaMessages: ov.messages, samplesApproved: ov.samplesApproved, creatorsPosted: ov.creatorsPosted, videos: ov.videos, views: ov.views,
      ...(hasAds ? { gmvMaxSpend: ad.spend, gmvMaxRevenue: ad.revenue } : {}),
    }
    const r = computeRoi(ad.revenue, ad.spend); if (r != null && hasAds) roi[name] = r
    const rv = ov.shopGmv != null ? computeRoi(ov.shopGmv, ad.spend) : null; if (rv != null) roiVs[name] = rv
  }
  return { scorecard: { ranges, roi, roiVsShopGmv: roiVs } }
}
export { round2 }
