// Weekly report, group 2: everything per creator, per video and per tier. Euka removed the query tool the old prompts
// used; its video export and video search carry the same rows, so the split is rebuilt here in code.
//   posted export (every video ever posted: creator, tier, post date, lifetime views)  -> creators, new creators, videos, views per tier
//   video search by sales window (GMV, items sold per video in the window)             -> orders, GMV per tier, tables
//   tier breakdown per period                                                           -> invites and samples per tier
// Totals are the sum of their tier rows, so a tier table always adds up to its headline.
import { format } from 'date-fns'
import type { EukaLike } from '@/lib/scorecard/engine'
import { BRAND_ID, EUKA_CONCURRENCY, mapPool } from '@/lib/scorecard/engine'
import { addDays } from '@/lib/scorecard'
import type { buildWindows } from '@/lib/assembleReport'
import type { ReportGroup1 } from './reportData'

type W = ReturnType<typeof buildWindows>
type Range = { start: string; end: string }
const LV = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'] as const
type Lv = typeof LV[number]
const r2 = (n: number) => Math.round(n * 100) / 100
const f = (d: Date) => format(d, 'yyyy-MM-dd')
const laDay = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) : '' }
const numOf = (v: unknown) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : 0 }
/** Euka's export labels creators with no level "L0"; Euka itself has no L0, and the report's rule puts unmatched creators in L1. */
export const tierKey = (t: unknown): Lv => { const k = String(t ?? '').toLowerCase(); return (LV as readonly string[]).includes(k) ? (k as Lv) : 'l1' }

/** RFC 4180 CSV: quoted fields may hold commas, quotes and line breaks (descriptions and transcripts do). */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = []
  let row: string[] = [], cur = '', q = false
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { row.push(cur); cur = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = [] }
    else cur += ch
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  const head = rows.shift() ?? []
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])))
}

export interface PostedVideo { id: string; creatorId: string; handle: string; tier: Lv; day: string; views: number; likes: number; comments: number; ggmv: number; product: string }
export interface SoldVideo { id: string; creatorId: string; handle: string; product: string; postedDay: string; gmv: number; items: number; views: number }

/** Run a video export and return its rows. The export is a file Euka generates; nothing in Euka changes. */
async function exportVideos(e: EukaLike, scope: unknown): Promise<Array<Record<string, string>>> {
  const start = await e.call('export_videos', { brandId: BRAND_ID, scope })
  const taskId = start?.taskId
  if (!taskId) throw new Error('export_videos returned no task id')
  for (let i = 0; i < 80; i++) {
    const st = await e.call('get_task_status', { brandId: BRAND_ID, taskId })
    if (st?.status === 'succeeded') break
    if (st?.status && st.status !== 'pending') throw new Error(`video export ${st.status}`)
    if (i === 79) throw new Error('video export did not finish in 4 minutes')
    await new Promise(r => setTimeout(r, 3000))
  }
  const link = await e.call('get_video_export_download_url', { brandId: BRAND_ID, taskId })
  if (link?.truncated) throw new Error('video export was truncated by Euka; the counts would be incomplete')
  const res = await fetch(String(link?.url), { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`video export download failed: HTTP ${res.status}`)
  return parseCsv(await res.text())
}

/** Every revenue-generating video in a sales window, all pages. */
async function soldIn(e: EukaLike, r: Range): Promise<SoldVideo[]> {
  const page = (n: number) => e.call('search_videos', { brandId: BRAND_ID, scope: { kind: 'commerceWindow', dateRange: { startDate: r.start, endDate: r.end }, sort: { field: 'attributedGmv', direction: 'desc' } }, page: n, pageSize: 100 })
  const out: SoldVideo[] = []
  for (let n = 1; n <= 200; n++) {
    const res = await page(n)
    for (const it of res?.items ?? []) out.push({
      id: String(it.videoId), creatorId: String(it.creator?.id ?? ''), handle: String(it.creator?.handle ?? ''), product: String(it.product?.title ?? ''), postedDay: laDay(String(it.postedAt ?? '')),
      gmv: numOf(it.performance?.commerce?.attributedGmv?.amount), items: numOf(it.performance?.commerce?.itemsSold), views: numOf(it.performance?.views),
    })
    if (!res?.pageInfo?.hasNextPage) break
  }
  return out
}

const SHORT: Array<[RegExp, string]> = [[/backseat extender/i, 'Back Seat Ext.'], [/xl floor cover/i, 'XL Floor Cover'], [/travel dog bed/i, 'Travel Dog Bed']]
const shortProduct = (t: string) => (SHORT.find(([re]) => re.test(t))?.[1] ?? t.slice(0, 40))
const inR = (d: string, r: Range) => d >= r.start && d <= r.end

export async function collectReportGroup2(euka: EukaLike, w: W, g1: ReportGroup1): Promise<{ pd: Record<string, any>; sources: Record<string, string>; gaps: string[]; controls: string[]; calls: number; ms: number }> {
  const t0 = Date.now()
  let calls = 0
  const e: EukaLike = { call: (n, a) => { calls++; return euka.call(n, a) } }
  const weeks: Range[] = w.weeks.map(x => ({ start: f(x.start), end: f(x.end) }))
  const months: Range[] = g1.pd._windows.months.map((m: any, i: number, all: any[]) => ({ start: m.start, end: i === all.length - 1 ? g1.pd._monthToDateThrough : m.end }))
  const d30: Range = w.d30, prior: Range = w.prior, last7: Range = w.last7

  // ---- Sources, fetched together
  const tiersFor = (r: Range) => e.call('get_dashboard_creator_level_breakdown', { brandId: BRAND_ID, postedDateRange: { startDate: r.start, endDate: r.end } })
  const [postedRows, sold30, soldPrior, soldWeeks, weekTiers, monthTiers, tiers30, tiersPrior, agentsRaw, creatives] = await Promise.all([
    exportVideos(e, { kind: 'lifetime', sort: { field: 'postedAt', direction: 'desc' } }),
    soldIn(e, d30), soldIn(e, prior),
    mapPool(weeks, EUKA_CONCURRENCY, r => soldIn(e, r)),
    mapPool(weeks, 3, tiersFor), mapPool(months, 3, tiersFor), tiersFor(d30), tiersFor(prior),
    listAgents(e, d30.start), listCreatives(e, d30),
  ])

  // ---- Every posted video, once, with its creator's tier
  const seen = new Set<string>()
  const posted: PostedVideo[] = []
  for (const r of postedRows) {
    const id = r['Video ID']; if (!id || seen.has(id)) continue
    seen.add(id)
    posted.push({ id, creatorId: r['Creator ID'], handle: r['Creator'], tier: tierKey(r['GMV Tier']), day: laDay(r['Date']), views: numOf(r['Views Count']), likes: numOf(r['Likes Count']), comments: numOf(r['Comments Count']), ggmv: numOf(r['Creator 30-Day GMV']), product: r['Product'] ?? '' })
  }
  const byVideo = new Map(posted.map(v => [v.id, v]))
  const tierOf = new Map<string, Lv>(), ggmvOf = new Map<string, number>(), firstPost = new Map<string, string>(), lifeVideos = new Map<string, number>()
  for (const v of posted) {
    tierOf.set(v.creatorId, v.tier); ggmvOf.set(v.creatorId, v.ggmv); lifeVideos.set(v.creatorId, (lifeVideos.get(v.creatorId) ?? 0) + 1)
    if (v.day && (!firstPost.has(v.creatorId) || v.day < firstPost.get(v.creatorId)!)) firstPost.set(v.creatorId, v.day)
  }
  const tierFor = (creatorId: string) => tierOf.get(creatorId) ?? 'l1'

  /** Posting activity in a period, by tier: distinct creators, creators whose first-ever post is in the period, videos, and views on those videos. */
  const postingByTier = (r: Range) => {
    const acc = Object.fromEntries(LV.map(l => [l, { c: new Set<string>(), n: new Set<string>(), videos: 0, views: 0 }])) as Record<Lv, { c: Set<string>; n: Set<string>; videos: number; views: number }>
    for (const v of posted) {
      if (!inR(v.day, r)) continue
      const a = acc[v.tier]; a.c.add(v.creatorId); a.videos++; a.views += v.views
      if (inR(firstPost.get(v.creatorId) ?? '', r)) a.n.add(v.creatorId)
    }
    return Object.fromEntries(LV.map(l => [l, { creators: acc[l].c.size, newCreators: acc[l].n.size, videos: acc[l].videos, views: acc[l].views }])) as Record<Lv, { creators: number; newCreators: number; videos: number; views: number }>
  }
  const gmvByTier = (rows: SoldVideo[]) => { const o = Object.fromEntries(LV.map(l => [l, 0])) as Record<Lv, number>; for (const v of rows) o[tierFor(v.creatorId)] += v.gmv; return Object.fromEntries(LV.map(l => [l, r2(o[l])])) as Record<Lv, number> }
  const tot = <T extends Record<string, number>>(m: Record<Lv, T>, k: keyof T) => LV.reduce((t, l) => t + (m[l][k] as number), 0)

  // ---- 30-day and prior. Creators, videos and GMV per level are Euka's own tier breakdown (they match its dashboard);
  // new creators and views per level come from the export. Every headline is the sum of its level rows.
  const tierRow = (list: any, l: Lv) => (list?.tiers ?? []).find((t: any) => String(t.tier).toLowerCase() === l)
  const levels = (list: any, r: Range) => { const p = postingByTier(r); return Object.fromEntries(LV.map(l => { const t = tierRow(list, l); return [l, { creators: numOf(t?.activeCreators), newCreators: p[l].newCreators, videos: numOf(t?.videos), views: p[l].views, gmv: r2(numOf(t?.totalGmv)) }] })) as Record<Lv, { creators: number; newCreators: number; videos: number; views: number; gmv: number }> }
  const sumL = (m: Record<Lv, any>, k: string) => LV.reduce((t, l) => t + numOf(m[l][k]), 0)
  const L30 = levels(tiers30, d30), LPrior = levels(tiersPrior, prior)
  const kpi = (L: ReturnType<typeof levels>, rows: SoldVideo[], base: any) => ({
    ...base, gmv: r2(sumL(L, 'gmv')), orders: rows.reduce((t, v) => t + v.items, 0), videos: sumL(L, 'videos'), views: sumL(L, 'views'), creators: sumL(L, 'creators'), newCreators: sumL(L, 'newCreators'),
  })
  const A1 = kpi(L30, sold30, g1.pd.A1), A2 = kpi(LPrior, soldPrior, g1.pd.A2)      // retention stays Euka's own figure from group 1
  const A3 = L30
  const p30 = postingByTier(d30)

  // ---- GMV Max by tier and by content age, from the creatives that spent in the window
  const spendTier = Object.fromEntries(LV.map(l => [l, { spend: 0, revenue: 0 }])) as Record<Lv, { spend: number; revenue: number }>
  const handleTier = new Map(posted.map(v => [v.handle.toLowerCase(), v.tier]))
  const ages: Array<[string, (days: number | null) => boolean]> = [['< 30 days', d => d !== null && d < 30], ['1–2 months', d => d !== null && d >= 30 && d < 60], ['2–3 months', d => d !== null && d >= 60 && d < 90], ['3–5 months', d => d !== null && d >= 90 && d < 150], ['5+ months', d => d !== null && d >= 150], ['Unknown post date', d => d === null]]
  const ageAcc = ages.map(([label]) => ({ label, videos: 0, spend: 0, revenue: 0 }))
  let adSpend = 0, adRev = 0
  for (const c of creatives) {
    const cost = numOf(c.metrics?.cost), rev = numOf(c.metrics?.grossRevenue); if (cost <= 0) continue
    adSpend += cost; adRev += rev
    const vid = byVideo.get(String(c.itemId)) ?? byVideo.get((String(c.tiktokUrl ?? '').match(/video\/(\d+)/) ?? [])[1] ?? '')
    const tier = vid?.tier ?? handleTier.get(String(c.creatorHandle ?? '').toLowerCase()) ?? 'l1'
    spendTier[tier].spend += cost; spendTier[tier].revenue += rev
    const days = vid?.day ? Math.round((Date.parse(d30.end) - Date.parse(vid.day)) / 86400000) : null
    const b = ageAcc[ages.findIndex(([, test]) => test(days))]; b.videos++; b.spend += cost; b.revenue += rev
  }
  // The header is Euka's ads overview. Spend it does not tie to a listed video (the difference) is shown as "Unknown post date"
  const headSpend = numOf(g1.pd.A6?.spend) || r2(adSpend), headRev = numOf(g1.pd.A6?.revenue) || r2(adRev)
  const restSpend = r2(headSpend - adSpend), restRev = r2(headRev - adRev)
  if (restSpend > 0.005) { const u = ageAcc[ageAcc.length - 1]; u.spend += restSpend; u.revenue += Math.max(0, restRev) }
  const A6 = { spend: r2(headSpend), revenue: r2(headRev), roi: headSpend > 0 ? r2(headRev / headSpend) : 0, ...Object.fromEntries(LV.map(l => [l, { spend: r2(spendTier[l].spend), roi: spendTier[l].spend > 0 ? r2(spendTier[l].revenue / spendTier[l].spend) : 0 }])) }
  const A7 = ageAcc.filter(b => b.videos > 0 || b.spend > 0).map(b => ({ label: b.label, videos: b.videos, spend: r2(b.spend), revenue: r2(b.revenue), roi: b.spend > 0 ? r2(b.revenue / b.spend) : 0, pct: headSpend > 0 ? Math.round((b.spend / headSpend) * 1000) / 10 : 0 }))

  // ---- 13 weeks and 6 months, by level: same sources as the 30-day table
  const series = (ranges: Range[], make: (r: Range, i: number) => Record<Lv, any>) => { const per = ranges.map(make); return Object.fromEntries(LV.map(l => [l, per.map(p => p[l])])) }
  const weekL = weeks.map((r, i) => levels(weekTiers[i], r)), monthL = months.map((r, i) => levels(monthTiers[i], r))
  const pick = (Ls: Array<ReturnType<typeof levels>>, keys: string[]) => series(Ls.map((_, i) => ({ start: String(i), end: '' })), (_, i) => Object.fromEntries(LV.map(l => [l, Object.fromEntries(keys.map(k => [k, (Ls[i][l] as any)[k]]))])) as any)
  const C2P = pick(weekL, ['creators', 'newCreators', 'videos']), C2V = pick(weekL, ['views', 'gmv'])
  const D2P = pick(monthL, ['creators', 'newCreators', 'videos']), D2V = pick(monthL, ['views', 'gmv'])
  const C1 = weeks.map((_, i) => ({ gmv: r2(sumL(weekL[i], 'gmv')), orders: soldWeeks[i].reduce((t, v) => t + v.items, 0) }))
  const C4 = weeks.map((_, i) => ({ videos: sumL(weekL[i], 'videos'), views: sumL(weekL[i], 'views') }))
  const C3 = g1.pd.C3, D3 = g1.pd.D3                                                // Euka's retention figures
  const outreachL = (list: any[], withApproved: boolean) => series(list.map((_, i) => ({ start: String(i), end: '' })), (_, i) => Object.fromEntries(LV.map(l => [l, { msgs: null, invites: tierRow(list[i], l)?.invitesSent ?? null, samples: tierRow(list[i], l)?.samplesDelivered ?? null, ...(withApproved ? { approved: tierRow(list[i], l)?.samplesApproved ?? null } : {}) }])) as any)
  const C5 = outreachL(weekTiers, false), D4 = outreachL(monthTiers, true)
  const D1 = months.map((_, i) => ({ ...(g1.pd.D1[i] ?? {}), gmv: r2(sumL(monthL[i], 'gmv')), views: sumL(monthL[i], 'views') }))

  // ---- Tables
  const creatorTable = (rows: SoldVideo[], r: Range) => {
    const m = new Map<string, { h: string; gmv: number; ord: number; views: number; vids: number }>()
    const vidSeen = new Set<string>()
    for (const v of rows) { const c = m.get(v.creatorId) ?? { h: v.handle, gmv: 0, ord: 0, views: 0, vids: 0 }; c.gmv += v.gmv; c.ord += v.items; c.views += v.views; if (!vidSeen.has(v.id)) { vidSeen.add(v.id); c.vids++ } m.set(v.creatorId, c) }
    const postedIn = new Map<string, PostedVideo[]>()
    for (const v of posted) if (inR(v.day, r)) postedIn.set(v.creatorId, [...(postedIn.get(v.creatorId) ?? []), v])
    return { m, postedIn }
  }
  const t30 = creatorTable(sold30, d30)
  const soldLast7 = soldWeeks[soldWeeks.length - 1], t7 = creatorTable(soldLast7, last7)
  const handleOf = new Map(posted.map(v => [v.creatorId, v.handle]))
  const topCreators = [...t30.m.entries()].sort((a, b) => b[1].gmv - a[1].gmv).slice(0, 15).map(([id, c]) => ({
    h: c.h, flw: null, sgmv: r2(c.gmv), ggmv: ggmvOf.get(id) ?? null, views: c.views, v30: (t30.postedIn.get(id) ?? []).length, vmgmv: c.vids, vlife: lifeVideos.get(id) ?? null,
    v7: posted.filter(v => v.creatorId === id && inR(v.day, last7)).length, ord: c.ord, aov: c.ord ? r2(c.gmv / c.ord) : 0, eng: null }))
  const videoRow = (v: SoldVideo) => { const pv = byVideo.get(v.id); return { h: v.handle, ggmv: ggmvOf.get(v.creatorId) ?? null, prod: shortProduct(v.product), gmv: r2(v.gmv), views: v.views, ord: v.items, aov: v.items ? r2(v.gmv / v.items) : 0, likes: pv?.likes ?? null, cmt: pv?.comments ?? null, clicks: null, date: v.postedDay } }
  const topVideos = sold30.slice(0, 15).map(videoRow)
  const soldById30 = new Map(sold30.map(v => [v.id, v]))
  const activeCreators = [...t30.postedIn.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 15).map(([id, vids]) => {
    const c = t30.m.get(id), views = vids.reduce((t, v) => t + v.views, 0)
    return { h: handleOf.get(id) ?? '', ggmv: ggmvOf.get(id) ?? null, flw: null, v30: vids.length, gmvN: r2(vids.reduce((t, v) => t + (soldById30.get(v.id)?.gmv ?? 0), 0)), gmvT: r2(c?.gmv ?? 0), views, avgv: vids.length ? Math.round(views / vids.length) : 0, ord: c?.ord ?? 0 } })
  const weekRow = (id: string, c: { h: string; gmv: number; ord: number; views: number } | undefined) => ({ h: c?.h ?? handleOf.get(id) ?? '', ggmv: ggmvOf.get(id) ?? null, gmv: r2(c?.gmv ?? 0), views: c?.views ?? 0, vid: (t7.postedIn.get(id) ?? []).length, ord: c?.ord ?? 0, aov: c?.ord ? r2(c.gmv / c.ord) : 0 })
  const weeklyTopCreators = [...t7.m.entries()].sort((a, b) => b[1].gmv - a[1].gmv).slice(0, 10).map(([id, c]) => weekRow(id, c))
  const weeklyTopVideos = soldLast7.filter(v => inR(v.postedDay, last7)).slice(0, 10).map(videoRow)
  const weeklyActiveCreators = [...t7.postedIn.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10).map(([id]) => weekRow(id, t7.m.get(id)))

  // ---- Agents created in the 30-day window (list data only; targeting details need one extra call per agent)
  const agents = agentsRaw.filter(a => String(a.created_time ?? '').slice(0, 10) >= d30.start).map(a => ({
    id: a.id, name: a.campaign_name ?? '', agent_type: a._type, campaign_type: a.campaign_type ?? '', status: a.bot_status ?? '', date_posted: String(a.created_time ?? '').slice(0, 10),
    gmv_filter: '', kw_filter: '', other_filters: '', list_segment: a.targeting_method ?? '', commission_display: '',
    creators_reached: numOf(a.total_conversations), remaining: numOf(a.remaining_creators), total_invites: numOf(a.total_target_invites), accepted_invites: numOf(a.total_target_accepted_invites), total_replies: numOf(a.total_replies),
    samples_requested: numOf(a.total_sample_request), samples_shipped: numOf(a.total_samples_shipped), total_videos: numOf(a.total_videos), total_revenue: numOf(a.total_revenue), product_count: Array.isArray(a.products) ? a.products.length : 0, has_followups: !!a.has_followups }))

  // ---- Controls: Euka's own dashboard figures beside the rebuilt ones, so a drift between sources is visible
  const g = g1.pd, controls: string[] = []
  const cmp = (label: string, mine: number | null, euka: number | null, tolPct: number) => { if (mine == null || euka == null) return; const diff = euka === 0 ? (mine === 0 ? 0 : 100) : Math.abs((mine - euka) / euka) * 100; controls.push(`${diff <= tolPct ? 'OK  ' : 'DIFF'} ${label}: rebuilt ${mine} vs Euka dashboard ${euka} (${Math.round(diff * 10) / 10}%)`) }
  const exp = { creators: new Set(posted.filter(v => inR(v.day, d30)).map(v => v.creatorId)).size, videos: LV.reduce((t, l) => t + p30[l].videos, 0) }
  cmp('30-day creators posting (export vs Euka tier breakdown)', exp.creators, A1.creators, 2); cmp('30-day videos (export vs Euka tier breakdown)', exp.videos, A1.videos, 5)
  cmp('30-day new creators (export vs Euka retention summary)', A1.newCreators, g.A1.newCreators, 5)
  cmp('30-day GMV (per-video sales vs Euka tier breakdown)', r2(sold30.reduce((t, v) => t + v.gmv, 0)), A1.gmv, 1)
  cmp('GMV Max spend tied to a video vs Euka ads overview', r2(adSpend), A6.spend, 100)
  g.C1.forEach((x: any, i: number) => cmp(`week ${weeks[i].start} GMV (Euka tier breakdown vs daily series)`, C1[i].gmv, x.gmv, 2))

  return {
    pd: { A1, A2, A3, A4: g.A4, A5: g.A5, A6, A7, C1, C2P, C2V, C3, C4, C5, D1, D2P, D2V, D3, D4, topCreators, topVideos, activeCreators, weeklyTopCreators, weeklyTopVideos, weeklyActiveCreators, agents,
      _counts: { postedVideos: posted.length, creatorsEver: tierOf.size, sold30: sold30.length, creatives: creatives.length, agentsListed: agentsRaw.length } },
    sources: {
      'new creators and views (all levels and totals)': 'export_videos (every video ever posted), one row per video, grouped by post date in America/Los_Angeles. "New" = the creator\'s first-ever post falls in the period. "Views" = lifetime views so far on videos posted in the period, the meaning earlier reports used.',
      'retention': 'creators who posted in both the prior period and this one, divided by creators who posted in the prior period, from the same export.',
      'creators, videos and gmv per level': 'get_dashboard_creator_level_breakdown for each period (30 days, each week, each month): activeCreators, videos, totalGmv. The headline is the sum of the seven levels.',
      'orders and the six tables': 'search_videos by sales window: GMV and items sold per video inside the window, whatever the post date. Orders = items sold.',
      'tiers': 'each creator\'s current Euka level from the export; "L0" and unmatched creators count as L1.',
      'A6 by tier, A7 content age': 'list_gmv_max_creatives for the window (spend and revenue per creative), joined to the video\'s post date and creator level.',
      agents: 'list_outreach_agents, all pages, created inside the 30-day window. Targeting filters and commission are not in the list data.',
    },
    gaps: [
      'Outreach MESSAGES per tier (A4, A5, C5, D4): Euka has no per-tier message count. Invites and samples per tier are provided instead; total messages are available.',
      'Followers and engagement rate in the creator tables: not in the export or the video search.',
      'Product clicks in the video tables: not available.',
      'Agent targeting filters and commission: need one extra Euka call per agent; not included yet.',
      'Re-engagement tags section: not rebuilt yet.',
    ],
    controls, calls, ms: Date.now() - t0,
  }
}

/** Outreach and CRM agents, newest first, 25 a page (Euka's limit). Stops once a whole page is older than `since`. */
async function listAgents(e: EukaLike, since: string): Promise<any[]> {
  const out: any[] = []
  for (const type of ['outreach', 'crm'] as const) {
    let got = 0
    for (let page = 1; page <= 60; page++) {
      const r = await e.call('list_outreach_agents', { brandId: BRAND_ID, agentType: type, archived: false, limit: 25, page })
      const rows = r?.agents ?? []
      for (const a of rows) out.push({ ...a, _type: type })
      got += rows.length
      if (!rows.length || got >= Number(r?.total ?? 0)) break
      if (rows.every((a: any) => String(a.created_time ?? '').slice(0, 10) < since)) break
    }
  }
  return out
}
async function listCreatives(e: EukaLike, r: Range): Promise<any[]> {
  const out: any[] = []
  for (let page = 1; page <= 80; page++) {
    const res = await e.call('list_gmv_max_creatives', { brandId: BRAND_ID, startDate: r.start, endDate: r.end, compare: 'none', minCost: 0.01, sortBy: 'cost', sortDirection: 'desc', page, pageSize: 100 })
    out.push(...(res?.rows ?? []))
    if (!res?.hasMore || !(res?.rows ?? []).length) break
  }
  return out
}
