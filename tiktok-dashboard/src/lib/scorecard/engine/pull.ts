// Euka pulls for the scorecard, on typed tools only. Every Euka result is cached by report date and step so a failed run resumes.
// Transport-agnostic: the GitHub run passes its MCP client (with a file cache), the dashboard passes its own.
import {
  ScorecardRaw, RangeRaw, weekRanges, monthRanges, addDays, monthOf, LAUNCH_DATE, computeRoi, round2,
} from '../index'
import { DailyMap, mergeAds, mergeSeries, sumRange, chunks, snapshotOnOrAfter } from './daily'
import { RAW_VERSION, StoredPeriod, Wanted, dailySpan, isSettled, planPulls, wantedPeriods } from './plan'
import { eukaChatFor, refreshEukaChat } from './eukaChat'
import { ContestCounts, ContestInfo, ContestMonth, contestCounts, contestFor as contestForMonth, resolveContestMonths } from './contests'

export const BRAND_ID = 'b4ec897a-fb59-48e7-9320-873ea5e25155'

/** Anything that can call a Euka tool and return its parsed JSON. `cache` is optional (the GitHub run caches to disk so a failed run resumes). */
export interface EukaLike {
  call(name: string, args?: Record<string, unknown>): Promise<any>
  cache?<T>(reportDate: string, step: string, fn: () => Promise<T>): Promise<T>
}
type Euka = EukaLike
const cached = <T>(e: EukaLike, reportDate: string, step: string, fn: () => Promise<T>): Promise<T> => (e.cache ? e.cache(reportDate, step, fn) : fn())

export const ADS_HISTORY_FROM = '2025-10-28'
/** Euka returns 0 for views before this; that is "no data", not zero. */
export const VIEWS_FROM = '2026-01-01'
const nz = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export interface Overview { error: boolean; errorText?: string; shopGmv: number | null; messages: number | null; samplesApproved: number | null; creatorsPosted: number | null; videos: number | null; views: number | null; truncated: boolean }

/** Range-level performance overview. A truncated range (outside TikTok's retention) yields nulls, never partial numbers. */
export async function pullOverview(e: Euka, asOf: string, a: string, b: string): Promise<Overview> {
  const r = await cached(e, asOf, `overview_${a}_${b}`, async () => {
    try { return await e.call('get_dashboard_performance_overview', { brandId: BRAND_ID, startDate: a, endDate: b, compareTo: { type: 'none' } }) }
    catch (err) { return { _error: String((err as Error).message).slice(0, 200) } }
  })
  const truncated = !!r?.performanceRangeCoverage?.isTruncated
  // A truncated range is outside TikTok's retention for shop and affiliate GMV only (Euka names the affected metrics in
  // sourceWarnings). Those yield null, never a partial number.
  const perf = (v: any) => (truncated || r?._error ? null : nz(v))
  // Euka's own counts (samples, creators, messages, videos) are not affected and are kept. A 0 in a truncated range is
  // ambiguous (a real zero, or before Euka had the data), so it stays "no data" rather than being stored as zero.
  const own = (v: any) => { const n = r?._error ? null : nz(v); return truncated && n === 0 ? null : n }
  return {
    error: !!r?._error, ...(r?._error ? { errorText: String(r._error) } : {}),
    shopGmv: perf(r?.totalShopGMV), messages: own(r?.messagesSent), samplesApproved: own(r?.samplesApproved),
    creatorsPosted: own(r?.activeCreators), videos: own(r?.videoConvRateTotalVideos),
    views: b < VIEWS_FROM || r?._error ? null : nz(r?.allAccountVideoViews), truncated,
  }
}

export async function pullAds(e: Euka, asOf: string, a: string, b: string) {
  const r = await cached(e, asOf, `ads_${a}_${b}`, () => e.call('get_dashboard_ads_overview', { brandId: BRAND_ID, postedDateRange: { startDate: a, endDate: b }, compareTo: { type: 'none' } }))
  const k = r?.adKpis ?? {}
  return { spend: nz(k.currentSpend), revenue: nz(k.currentRevenue), roas: nz(k.currentRoas), orders: nz(k.currentOrders) }
}

/** Daily series for the whole span, in 31-day chunks. */
/** Euka calls in flight at once. Four parallel calls were checked against the live server; more risks rate limits. */
export const EUKA_CONCURRENCY = 4

/** Run `fn` over `items` with at most `n` in flight. Results keep the input order. The first error stops new work and is thrown. */
export async function mapPool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0, failed = false
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++
      try { out[i] = await fn(items[i], i) } catch (err) { failed = true; throw err }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker))
  return out
}

/** Daily series for the whole span, in 31-day chunks. Chunks cover different days, so they are fetched in parallel. */
export async function pullDaily(e: Euka, asOf: string, from: string, to: string): Promise<DailyMap> {
  const daily: DailyMap = {}
  const parts = await mapPool(chunks(from, to, 31), Math.max(1, Math.floor(EUKA_CONCURRENCY / 2)), ([a, b]) => Promise.all([
    cached(e, asOf, `series_${a}_${b}`, () => e.call('get_dashboard_performance_series', { brandId: BRAND_ID, startDate: a, endDate: b })),
    cached(e, asOf, `adsdaily_${a}_${b}`, () => e.call('get_dashboard_ads_overview', { brandId: BRAND_ID, postedDateRange: { startDate: a, endDate: b }, compareTo: { type: 'none' } })),
  ]))
  for (const [series, ads] of parts) { mergeSeries(daily, series); mergeAds(daily, ads) }
  return daily
}

export async function listContests(e: Euka, asOf: string): Promise<ContestInfo[]> {
  const list = await cached(e, asOf, 'contests', () => e.call('list_contests', { brandId: BRAND_ID, limit: 100, offset: 0 }))
  return (list?.contests ?? []).map((c: any) => ({ id: Number(c.id), type: String(c.type), status: String(c.status), startDate: String(c.startDate), endDate: String(c.endDate) }))
}
export const fetchContestIds = (e: Euka, asOf: string) => (contestId: number): Promise<string[]> =>
  cached(e, asOf, `contest_${contestId}`, async () => {
    const out: string[] = []
    for (let offset = 0; ; offset += 100) {
      const r = await e.call('get_contest', { brandId: BRAND_ID, contestId: String(contestId), limit: 100, offset })
      for (const p of r?.participants ?? []) out.push(String(p.creatorId))
      if (!r?.pagination?.hasMoreParticipants) break
    }
    return out
  })

/** Distinct creators with active usage rights right now. Euka has no dated source, so history comes from daily snapshots. */
export async function pullUsageRightsNow(e: Euka, asOf: string): Promise<number> {
  const ids = await cached(e, asOf, 'usage_rights_creators', async () => {
    // One request per licensed video, so there are thousands. Pages are read a few at a time; oldest first keeps the
    // page boundaries stable while new requests arrive.
    const page = (n: number) => e.call('search_usage_rights_requests', { brandId: BRAND_ID, filter: { archived: 'include', states: ['active'] }, sort: { field: 'createdAt', direction: 'asc' }, page: n, pageSize: 100 })
    const set = new Set<string>()
    const add = (r: any) => { for (const it of r?.items ?? []) if (it?.creator?.id) set.add(String(it.creator.id)) }
    const first = await page(1); add(first)
    const pages = Math.ceil((Number(first?.total) || 0) / 100)
    const rest = await mapPool(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2), EUKA_CONCURRENCY, page)
    rest.forEach(add)
    return [...set]
  })
  return ids.length
}

export interface PullCtx {
  usageSnaps: Array<{ snap_date: string; value: number }>; usageNow: number; contestFor: (month: string) => number | null; latestWeekEnd: string
  /** Team-sent Euka Chat messages in a date range (line 7). null before the first one was ever sent. */
  eukaChatFor: (a: string, b: string) => number | null
}

/** Pull the given periods from Euka. The daily series is fetched only for the days they cover. */
export interface PeriodDiag {
  /** Text of the overview call's error, when it failed after retries. The period is then not final. */
  overviewError?: string
  /** Euka marked the range as cut short by TikTok's retention. */
  truncated: boolean
  /** Range-level totals from the overview, independent of the daily series, for cross-checking. */
  control: { shopGmv: number | null; videos: number | null }
}
export async function pullPeriods(
  e: Euka, asOf: string, dataThrough: string, list: Wanted[], ctx: PullCtx, gaps: string[] = [],
  /** A daily series the caller already fetched for these days, so the same days are not asked for twice. */
  pre: { daily?: DailyMap } = {},
): Promise<{ periods: StoredPeriod[]; daily: DailyMap; diag: Record<string, PeriodDiag> }> {
  const span = dailySpan(list)
  const diag: Record<string, PeriodDiag> = {}
  if (!span) return { periods: [], daily: {}, diag }
  const daily = pre.daily ?? await pullDaily(e, asOf, span.from, span.to)
  // One overview per period. They are independent, so they run a few at a time.
  const overviews = await mapPool(list, EUKA_CONCURRENCY, w => pullOverview(e, asOf, w.start, w.end))
  const ads = { historyFrom: ADS_HISTORY_FROM }
  const periods: StoredPeriod[] = []
  for (const [i, w] of list.entries()) {
    const a = w.start, b = w.end
    const ov = overviews[i]
    diag[`${w.type}:${w.key}`] = { ...(ov.error ? { overviewError: ov.errorText ?? 'unknown error' } : {}), truncated: ov.truncated, control: { shopGmv: ov.shopGmv, videos: ov.videos } }
    const usageEnd = w.type === 'week' ? (b === ctx.latestWeekEnd ? 'now' : b) : (w.partial ? 'now' : b)
    const raw: RangeRaw = {
      shopGmv: sumRange(daily, a, b, 'shopGmv', {}, gaps),
      gmvMaxSpend: sumRange(daily, a, b, 'spend', ads, gaps),
      gmvMaxRevenue: sumRange(daily, a, b, 'revenue', ads, gaps),
      targetInvites: sumRange(daily, a, b, 'invites', {}, gaps),
      emails: sumRange(daily, a, b, 'emails', {}, gaps),
      eukaMessages: ctx.eukaChatFor(a, b),
      videos: sumRange(daily, a, b, 'videos', {}, gaps),
      samplesApproved: ov.samplesApproved, creatorsPosted: ov.creatorsPosted, views: ov.views,
      contestAffiliates: ctx.contestFor(monthOf(b)),
      usageRightsCreators: usageEnd === 'now' ? ctx.usageNow : snapshotOnOrAfter(ctx.usageSnaps, addDays(usageEnd, 1)),
    }
    // A pull that hit an error is never marked final, so it is retried next run instead of becoming permanent
    periods.push({ period_type: w.type, period_key: w.key, start_date: a, end_date: b, raw, raw_version: RAW_VERSION, final: !ov.error && isSettled(b, dataThrough, w.partial) })
  }
  return { periods, daily, diag }
}

/** Turn stored and freshly pulled periods into the raw block the scorecard is built from. Shared by every run. */
export function assembleRaw(o: { asOf: string; yearStart: string; dataThrough: string; periods: StoredPeriod[]; allTime: RangeRaw; daily?: DailyMap; pulled: number }): ScorecardRaw {
  const weeks: ScorecardRaw['weeks'] = {}, months: ScorecardRaw['months'] = {}
  for (const p of o.periods) (p.period_type === 'week' ? weeks : months)[p.period_key] = p.raw
  // Daily rows exist only for pulled periods; stored periods were audited when they were stored
  const rawDaily: NonNullable<ScorecardRaw['daily']> = {}
  for (const [d, x] of Object.entries(o.daily ?? {})) if (x.spend !== undefined || x.revenue !== undefined) rawDaily[d] = { gmvMaxSpend: x.spend ?? null, gmvMaxRevenue: x.revenue ?? null }
  const notes = [
    'Videos, Target Collab invites and emails come from the daily series of get_dashboard_performance_series; a period with any missing day shows no data rather than a partial sum.',
    'Euka Chat messages sent counts messages the team sent in Euka Chat (inside Euka\'s creator app), by Los Angeles day. Automated outreach delivered as TikTok Shop DMs is not counted. Periods before the first Euka Chat message show no data.',
    'Affiliates with usage rights are distinct creators with an active request. Euka has no dated source, so history before the first daily snapshot shows no data.',
    'Contest affiliates count each creator once per calendar month across all of that month\'s contests (Retainers excluded). A contest belongs to the month it starts in.',
    'Euka reports views as 0 before 2026-01-01; those periods show no data.',
    `Stored periods are reused once final (14 days after they end). This run pulled ${o.pulled} of ${o.periods.length} periods.`,
  ]
  return { asOf: o.asOf, yearStart: o.yearStart, dataThrough: o.dataThrough, weeks, months, allTime: o.allTime, ...(o.daily ? { daily: rawDaily } : {}), notes }
}

export interface PullResult {
  raw: ScorecardRaw; fresh: StoredPeriod[]; reused: StoredPeriod[]; pulledCount: number; reusedCount: number
  reasons: Record<string, string>; gaps: string[]; usageNow: number; ctx: PullCtx
  contestMonthsFresh: ContestMonth[]; contests: ContestCounts
}

/**
 * Incremental pull. Stored final periods are reused as they are; only missing, unsettled or invalidated periods are
 * pulled from Euka. Finished contest months come from the store; only open months are fetched.
 */
export async function pullScorecardRaw(
  e: Euka, asOf: string, dataThrough: string, yearStart: string,
  usageSnaps: Array<{ snap_date: string; value: number }>, stored: StoredPeriod[], storedContests: ContestMonth[], force = false,
): Promise<PullResult> {
  const gaps: string[] = []
  const plan = planPulls(wantedPeriods(asOf, dataThrough, yearStart), stored, { force })
  const { months: contestMonths, fresh: contestMonthsFresh } = await resolveContestMonths(await listContests(e, asOf), force ? [] : storedContests, dataThrough, fetchContestIds(e, asOf))
  const contests = contestCounts(contestMonths)
  const usageNow = await pullUsageRightsNow(e, asOf)
  const chat = await refreshEukaChat(e, {})
  const ctx: PullCtx = { usageSnaps, usageNow, contestFor: m => contestForMonth(contests, m), latestWeekEnd: weekRanges(asOf, 1)[0].end, eukaChatFor: eukaChatFor(chat.cache) }

  const { periods: fresh, daily } = await pullPeriods(e, asOf, dataThrough, plan.toPull, ctx, gaps)
  const all = [...plan.reused, ...fresh]
  const allTime: RangeRaw = {
    creatorsPosted: (await pullOverview(e, asOf, LAUNCH_DATE, dataThrough)).creatorsPosted,
    contestAffiliates: contests.allTime || null,
    usageRightsCreators: usageNow,
  }
  const raw = assembleRaw({ asOf, yearStart, dataThrough, periods: all, allTime, daily, pulled: fresh.length })
  return { raw, fresh, reused: plan.reused, pulledCount: fresh.length, reusedCount: plan.reused.length, reasons: plan.reasons, gaps, usageNow, ctx, contestMonthsFresh, contests }
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
      shopGmv: ov.shopGmv, samplesApproved: ov.samplesApproved, creatorsPosted: ov.creatorsPosted, videos: ov.videos, views: ov.views,
      ...(hasAds ? { gmvMaxSpend: ad.spend, gmvMaxRevenue: ad.revenue } : {}),
    }
    const r = computeRoi(ad.revenue, ad.spend); if (r != null && hasAds) roi[name] = r
    const rv = ov.shopGmv != null ? computeRoi(ov.shopGmv, ad.spend) : null; if (rv != null) roiVs[name] = rv
  }
  return { scorecard: { ranges, roi, roiVsShopGmv: roiVs } }
}
export { round2 }
