import { describe, expect, it } from 'vitest'
import { addDays, auditScorecard, buildTodo, scorecardHealth, HealthInput, ManualEntry, Scorecard, ScorecardRaw } from '../index'
import {
  AlertRecord, BackfillState, BackfillStore, Deps, LockRec, STALL_MS, backfillWanted, cancelRun, checkStall, classify, firstFullWeekStart,
  nextBatch, resumeRun, runCounts, runStep, startRun,
} from './backfill'
import { StoredPeriod, isSettled } from './plan'
import { ContestMonth } from './contests'
import { EukaLike } from './pull'
import { ChatCache, eukaChatFor } from './eukaChat'

const TODAY = '2026-11-16', THROUGH = '2026-11-15'

// ---- Fakes ------------------------------------------------------------------------------------------------------
function memoryStore() {
  let lock: string | null = null
  let state: BackfillState | null = null
  let chat: ChatCache = {}
  const periods = new Map<string, StoredPeriod>()
  const contestMonths = new Map<string, ContestMonth>()
  const published: Array<{ asOf: string; raw: ScorecardRaw; scorecard: Scorecard; audit: any }> = []
  const store: BackfillStore = {
    async readLock() { return lock ? { raw: lock, rec: JSON.parse(lock) as LockRec } : null },
    async casLock(expected, next) { if (lock !== expected) return false; lock = JSON.stringify(next); return true },
    async readState() { return state ? JSON.parse(JSON.stringify(state)) : null },
    async writeState(s) { state = JSON.parse(JSON.stringify(s)) },
    async loadPeriods() { return [...periods.values()] },
    async savePeriods(p) { for (const x of p) periods.set(`${x.period_type}:${x.period_key}`, x) },
    async loadContestMonths() { return [...contestMonths.values()] },
    async saveContestMonths(m) { for (const x of m) contestMonths.set(x.month, x) },
    async loadSnapshots() { return [] },
    async loadManual() { return [] as ManualEntry[] },
    async loadChatCache() { return JSON.parse(JSON.stringify(chat)) },
    async saveChatCache(c) { chat = JSON.parse(JSON.stringify(c)) },
    async publish(asOf, raw, scorecard, audit) { published.push({ asOf, raw, scorecard, audit }) },
  }
  return { store, periods, published, get lock() { return lock }, get state() { return state } }
}

const msg = (ts: string, senderType: 'Manager' | 'Member', kind = 'message', channel = 'CreatorAppChat') => ({ kind, channel, senderType, internalDate: Date.parse(ts), data: { providerTimestamp: ts } })
const CHAT_THREADS = [
  { id: 't1', at: 1, items: [
    msg('2026-11-10T18:00:00Z', 'Manager'), msg('2026-11-10T19:00:00Z', 'Manager'), msg('2026-11-10T20:00:00Z', 'Member'),
    msg('2026-11-03T18:00:00Z', 'Manager'), msg('2026-11-10T21:00:00Z', 'Manager', 'note'),
    msg('2026-11-15T06:30:00Z', 'Manager'),      // 10:30 pm Nov 14 in Los Angeles: belongs to the week ending Nov 14
  ] },
  { id: 't2', at: 2, items: [msg('2026-06-15T18:00:00Z', 'Manager'), msg('2026-06-16T18:00:00Z', 'Member')] },
]
interface FakeOpts { chatThreads?: typeof CHAT_THREADS; shopGmvThrough?: string; dataFrom?: string; failSeries?: (start: string, end: string) => boolean; overviewFails?: (start: string, end: string) => boolean }
/** A Euka that returns consistent daily rows. Before `dataFrom` it returns nothing, as Euka does outside TikTok retention. */
function fakeEuka(o: FakeOpts = {}) {
  const calls: Array<{ name: string; args: any }> = []
  const from = o.dataFrom ?? '2025-10-01'
  const days = (a: string, b: string) => { const out: string[] = []; for (let d = a; d <= b; d = addDays(d, 1)) if (d >= from) out.push(d); return out }
  const gmv = (d: string) => 1000 + Number(d.slice(8, 10))
  const e: EukaLike = {
    async call(name, args: any = {}) {
      calls.push({ name, args })
      if (name === 'get_dashboard_performance_series') {
        if (o.failSeries?.(args.startDate, args.endDate)) throw new Error('get_dashboard_performance_series failed after 3 tries: upstream 520')
        const ds = days(args.startDate, args.endDate)
        return { data: {
          videoPosted: ds.map(date => ({ date, videos_posted: 10 })),
          performances: ds.filter(date => !o.shopGmvThrough || date <= o.shopGmvThrough).map(date => ({ date, total_shop_gmv: gmv(date) })),
          analyticsAggregated: ds.map(date => ({ date, messages_sent: 100, target_invites: 50, emails_sent: 5 })),
        } }
      }
      if (name === 'get_dashboard_ads_overview') {
        const ds = days(args.postedDateRange.startDate, args.postedDateRange.endDate).filter(d => d >= '2025-10-28')
        return { adKpis: {}, dailyRoas: ds.map(date => ({ date, cost: 200, revenue: 700 })) }
      }
      if (name === 'get_dashboard_performance_overview') {
        if (o.overviewFails?.(args.startDate, args.endDate)) throw new Error('get_dashboard_performance_overview: timeout')
        const ds = days(args.startDate, args.endDate)
        const none = ds.length === 0
        return {
          performanceRangeCoverage: { isTruncated: args.startDate < from },
          totalShopGMV: none ? null : Math.round(ds.reduce((t, d) => t + gmv(d), 0) * 100) / 100, messagesSent: none ? null : ds.length * 100,
          samplesApproved: none ? null : 3, activeCreators: none ? null : 20, videoConvRateTotalVideos: none ? null : ds.length * 10,
          allAccountVideoViews: none ? 0 : ds.length * 1000,
        }
      }
      // Two Euka Chat conversations. Only team-sent messages count; creator messages, notes and other channels do not.
      if (name === 'list_inbox_threads') return { items: (o.chatThreads ?? CHAT_THREADS).map(t => ({ id: t.id, internalDate: t.at })), nextCursor: null }
      if (name === 'list_inbox_thread_timeline') return { items: (o.chatThreads ?? CHAT_THREADS).find(t => t.id === args.threadId)!.items, nextCursor: null }
      if (name === 'list_contests') return { contests: [{ id: 7, type: 'posting', status: 'completed', startDate: '2026-03-01', endDate: '2026-03-31' }] }
      if (name === 'get_contest') return { participants: [{ creatorId: 'a' }, { creatorId: 'b' }], pagination: { hasMoreParticipants: false } }
      if (name === 'search_usage_rights_requests') return { items: [{ creator: { id: 'c1' } }, { creator: { id: 'c2' } }], total: 2 }
      throw new Error(`unexpected tool ${name}`)
    },
  }
  return { e, calls, seriesCalls: () => calls.filter(c => c.name === 'get_dashboard_performance_series').length }
}

function harness(o: FakeOpts = {}) {
  const mem = memoryStore(), fake = fakeEuka(o)
  const clock = { t: Date.parse('2026-11-16T18:00:00Z') }
  const sent: Array<{ kind: AlertRecord['kind']; text: string }> = []
  let n = 0
  const deps: Deps = {
    store: mem.store, euka: async () => fake.e, now: () => clock.t, today: () => TODAY, newId: () => `run${++n}`,
    notify: async (kind, text) => { sent.push({ kind, text }); return { slack: 'not sent: SLACK_WEBHOOK_URL is not set in Vercel', email: 'not sent' } },
  }
  /** Drive steps the way the panel does, until the run stops. */
  const drive = async (runId: string, maxPeriods?: number) => {
    let steps = 0
    for (;;) {
      const r = await runStep(deps, { runId, ...(maxPeriods ? { maxPeriods } : {}) })
      steps++
      if (!r.ok || r.state.status !== 'running') return { r, steps }
      if (steps > 200) throw new Error('did not finish')
    }
  }
  return { mem, fake, clock, sent, deps, drive }
}
const count = (s: BackfillState, st: string) => s.periods.filter(p => p.status === st).length

// ---- Coverage ---------------------------------------------------------------------------------------------------
describe('coverage', () => {
  it('starts at the first full Sunday to Saturday week of October 2025', () => {
    expect(firstFullWeekStart('2025-10-01')).toBe('2025-10-05')
    expect(firstFullWeekStart('2025-10-05')).toBe('2025-10-05')
  })
  it('covers every week through the last complete one and every month through the current month to date', () => {
    const w = backfillWanted(TODAY, THROUGH, '2025-10-01')
    const weeks = w.filter(x => x.type === 'week'), months = w.filter(x => x.type === 'month')
    expect(weeks[0]).toMatchObject({ start: '2026-11-08', end: '2026-11-14' })
    expect(weeks[weeks.length - 1]).toMatchObject({ start: '2025-10-05', end: '2025-10-11' })
    expect(weeks).toHaveLength(58)
    for (let i = 1; i < weeks.length; i++) expect(weeks[i].start).toBe(addDays(weeks[i - 1].start, -7))
    expect(months.map(m => m.key)).toEqual(['2026-11', '2026-10', '2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01', '2025-12', '2025-11', '2025-10'])
    expect(months[0]).toMatchObject({ start: '2026-11-01', end: THROUGH, partial: true })
  })
})

// ---- Chunking ---------------------------------------------------------------------------------------------------
describe('chunking', () => {
  const wanted = backfillWanted(TODAY, THROUGH, '2025-10-01')
  it('a batch is one calendar month plus the weeks that end in it, newest month first', () => {
    let rest = wanted, batches = 0
    const anchors: string[] = []
    while (rest.length) {
      const b = nextBatch(rest)
      expect(b.length).toBeGreaterThan(0); expect(b.length).toBeLessThanOrEqual(6)
      const months = new Set(b.map(x => x.end.slice(0, 7)))
      expect(months.size).toBe(1)                                   // every period in the batch ends in the same month
      expect(b.filter(x => x.type === 'month')).toHaveLength(1)
      anchors.push([...months][0])
      const ids = new Set(b.map(x => `${x.type}:${x.key}`))
      rest = rest.filter(x => !ids.has(`${x.type}:${x.key}`)); batches++
    }
    expect(batches).toBe(14)                                        // one per month, was 29 batches before
    expect(anchors[0]).toBe('2026-11'); expect(anchors[13]).toBe('2025-10')
  })
  it('a batch can be capped, for the one-week proof', () => {
    expect(nextBatch(wanted, 1)).toEqual([wanted[0]])
  })
  it('the whole backfill asks Euka for each day once and each period once', async () => {
    const h = harness()
    await startRun(h.deps, {})
    await h.drive('run1')
    const n = (name: string) => h.fake.calls.filter(c => c.name === name).length
    expect(n('get_dashboard_performance_series')).toBe(14)          // one per month; weeks reuse the month's rows
    expect(n('get_dashboard_ads_overview')).toBe(14)
    expect(n('get_dashboard_performance_overview')).toBe(73)        // 72 periods and the all-time range
    for (const c of h.fake.calls.filter(x => x.name === 'get_dashboard_performance_series')) expect(c.args.startDate.slice(8)).toBe('01')
  })
  it('Euka calls run in parallel, never more than 4 at once', async () => {
    const h = harness()
    let inFlight = 0, peak = 0
    const slow: EukaLike = { call: async (n, a) => { inFlight++; peak = Math.max(peak, inFlight); await new Promise(r => setTimeout(r, 2)); try { return await h.fake.e.call(n, a) } finally { inFlight-- } } }
    const deps = { ...h.deps, euka: async () => slow }
    await startRun(deps, {})
    let r = await runStep(deps, { runId: 'run1' })
    while (r.ok && r.state.status === 'running') r = await runStep(deps, { runId: 'run1' })
    expect(r.ok && r.state.status).toBe('done')
    expect(peak).toBeGreaterThan(1); expect(peak).toBeLessThanOrEqual(4)
  })
  it('a failed call inside a parallel batch stops the batch and nothing from it is saved', async () => {
    const h = harness({ failSeries: a => a === '2026-11-01' })
    await startRun(h.deps, {})
    const { r } = await h.drive('run1')
    expect(r.state!.status).toBe('failed')
    expect(h.mem.periods.size).toBe(0)
  })
  it('each step processes a bounded batch and reports progress; the run finishes over many steps', async () => {
    const h = harness()
    const st = await startRun(h.deps, {}); expect(st.ok).toBe(true)
    const r1 = await runStep(h.deps, { runId: 'run1', maxPeriods: 4 })
    expect(r1.ok && count(r1.state, 'stored')).toBe(4)
    expect(r1.ok && count(r1.state, 'pending')).toBe(68)
    expect(r1.ok && r1.state.status).toBe('running')
    expect(h.mem.periods.size).toBe(4)                       // saved before the next batch
    const { r, steps } = await h.drive('run1', 4)
    expect(steps).toBeGreaterThan(10)
    expect(r.ok && r.state.status).toBe('done')
    expect(r.ok && count(r.state, 'pending')).toBe(0)
  })
  it('a step stops starting new batches once its time budget is used', async () => {
    const h = harness()
    await startRun(h.deps, {})
    const slow = { ...h.deps, euka: async () => ({ call: async (n: string, a?: Record<string, unknown>) => { h.clock.t += 20_000; return h.fake.e.call(n, a) } }) }
    const r = await runStep(slow, { runId: 'run1', budgetMs: 150_000 })
    expect(r.ok && r.state.status).toBe('running')
    expect(r.ok && count(r.state, 'pending')).toBeGreaterThan(50)
    expect(h.clock.t - Date.parse('2026-11-16T18:00:00Z')).toBeLessThan(300_000) // inside the 300 s function limit
  })
})

// ---- Publish ----------------------------------------------------------------------------------------------------
describe('finish and publish', () => {
  it('publishes an audited scorecard straight to the store, with the current month to date and a straight-line estimate', async () => {
    const h = harness()
    await startRun(h.deps, {})
    const { r } = await h.drive('run1')
    expect(r.ok && r.state.status).toBe('done')
    expect(h.mem.published).toHaveLength(1)
    const pub = h.mem.published[0]
    expect(pub.asOf).toBe(TODAY); expect(pub.audit.status).toBe('PASS')
    expect(pub.scorecard.weeklyAll).toHaveLength(58)
    expect(pub.scorecard.monthly).toHaveLength(14)
    const cur = pub.scorecard.monthly[0]
    expect(cur).toMatchObject({ key: '2026-11', partial: true, daysElapsed: 15, daysInMonth: 30 })
    expect(cur.projected!.gmv).toBe(Math.round((cur.mtd.gmv! / 15) * 30 * 100) / 100)
    const s = h.mem.state!.summary!
    expect(s).toMatchObject({ weeksStored: 58, monthsStored: 14, noData: [], publishedAsOf: TODAY })
    expect(s.cofundedTodo).toMatchObject({ weeks: 58, months: 14 })   // the only line with no Euka source
    expect(buildTodo(pub.scorecard).cofunded).toHaveLength(72)        // what /api/admin/scorecard-todo will return
    expect(h.sent).toHaveLength(0)
  })
  it('reproduces the live Euka week of 2026-11-08 to 2026-11-14 from its real daily rows', async () => {
    const row = (vals: number[]) => vals.map((v, i) => [`2026-11-${String(8 + i).padStart(2, '0')}`, v] as const)
    const series = { data: {
      videoPosted: row([90, 86, 68, 92, 71, 57, 82]).map(([date, v]) => ({ date, videos_posted: v })),
      performances: row([8047.42, 8124.83, 8006.51, 11585.26, 14704.5, 12043.38, 14826.62]).map(([date, v]) => ({ date, total_shop_gmv: v })),
      analyticsAggregated: row([9395, 7234, 5732, 2039, 3045, 4150, 6587]).map(([date, m], i) => ({ date, messages_sent: m, target_invites: [9585, 7298, 3901, 9885, 9938, 9294, 9686][i], emails_sent: [79, 49, 230, 129, 110, 128, 120][i] })),
    } }
    const ads = { dailyRoas: row([2633.55, 2488.54, 2388.78, 3175.52, 4796.4, 3961.78, 4464.49]).map(([date, cost], i) => ({ date, cost, revenue: [9249.36, 9081.03, 8653.85, 13774.92, 17867.32, 14423.15, 16109.53][i] })) }
    const overview = { performanceRangeCoverage: { isTruncated: false }, totalShopGMV: 77338.52, messagesSent: 38182, samplesApproved: 31, activeCreators: 129, videoConvRateTotalVideos: 546, allAccountVideoViews: 3126914 }
    const h = harness()
    const base = h.fake.e
    // The month's rows come back as usual; the seven live days replace the generated ones
    const swap = (rows: any[], real: any[]) => rows.map(r => real.find(x => x.date === r.date) ?? r)
    const live: EukaLike = { call: async (n, a: any = {}) => {
      const out = await base.call(n, a)
      if (n === 'get_dashboard_performance_series') for (const k of ['videoPosted', 'performances', 'analyticsAggregated'] as const) out.data[k] = swap(out.data[k], series.data[k])
      if (n === 'get_dashboard_ads_overview') out.dailyRoas = swap(out.dailyRoas, ads.dailyRoas)
      if (n === 'get_dashboard_performance_overview' && a.startDate === '2026-11-08') return overview
      return out
    } }
    const deps = { ...h.deps, euka: async () => live }
    const st = await startRun(deps, { mode: 'proof' })
    expect(st.ok && st.state.periods.map(p => p.id)).toEqual(['week:2026-11-08'])
    let r = await runStep(deps, { runId: 'run1' })
    while (r.ok && r.state.status === 'running') r = await runStep(deps, { runId: 'run1' })
    expect(r.ok && r.state.status).toBe('done')
    const proof = h.mem.state!.summary!.proof!
    expect(proof.raw).toMatchObject({
      shopGmv: 77338.52, gmvMaxSpend: 23909.06, gmvMaxRevenue: 89159.16, targetInvites: 59587, emails: 845,
      videos: 546, samplesApproved: 31, creatorsPosted: 129, views: 3126914,
    })
    expect(proof.gmvMaxRoi).toBe(3.73)
    expect(h.mem.state!.periods[0]).toMatchObject({ status: 'stored' })
    expect(h.mem.state!.periods[0].controlDiffs).toBeUndefined()   // daily sums equal Euka's own range totals
    expect(h.mem.published).toHaveLength(1)
  })
})

// ---- Resume -----------------------------------------------------------------------------------------------------
describe('resume after a mid-run failure', () => {
  it('keeps what was saved, alerts with the period and next step, and continues without repeating finished periods', async () => {
    let broken = true
    const h = harness({ failSeries: (a, b) => broken && a <= '2026-08-20' && b >= '2026-08-20' })
    await startRun(h.deps, {})
    const first = await h.drive('run1')
    const s1 = first.r.state!
    expect(s1.status).toBe('failed')
    expect(s1.lastError!.message).toContain('upstream 520')
    expect(s1.lastError!.nextStep).toContain('Resume')
    const saved = h.mem.periods.size
    expect(saved).toBeGreaterThan(0)
    expect(count(s1, 'stored')).toBe(saved)
    expect(count(s1, 'error')).toBeGreaterThan(0)
    expect(h.mem.published).toHaveLength(0)
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].kind).toBe('FAILED')
    expect(h.sent[0].text).toContain('failed at Week 2026-09-20 to 2026-09-26')   // the batch that needed August's rows
    expect(s1.alerts[0].slack).toContain('SLACK_WEBHOOK_URL')      // an undelivered alert is recorded, never silent
    // a step on a failed run is refused until it is resumed
    expect((await runStep(h.deps, { runId: 'run1' })).ok).toBe(false)

    broken = false
    const before = h.fake.calls.length
    const res = await resumeRun(h.deps)
    expect(res.ok && res.state.runId).toBe('run1')
    expect(res.ok && count(res.state, 'error')).toBe(0)
    expect(res.ok && count(res.state, 'stored')).toBe(saved)
    const second = await h.drive('run1')
    expect(second.r.state!.status).toBe('done')
    const repulled = h.fake.calls.slice(before).filter(c => c.name === 'get_dashboard_performance_overview' && c.args.startDate >= '2026-09-27')
    expect(repulled).toHaveLength(0)                               // the October and November batches finished before the failure and were not pulled again
    expect(h.mem.published).toHaveLength(1)
    expect(h.mem.periods.size).toBe(72)
  })
  it('a cancelled run can be resumed', async () => {
    const h = harness()
    await startRun(h.deps, {})
    await runStep(h.deps, { runId: 'run1', maxPeriods: 4 })
    expect((await cancelRun(h.deps))!.status).toBe('cancelled')
    expect((await resumeRun(h.deps)).ok).toBe(true)
    expect((await h.drive('run1')).r.state!.status).toBe('done')
  })
})

// ---- Lock -------------------------------------------------------------------------------------------------------
describe('lock: one run at a time', () => {
  it('a second admin cannot start while a run is in progress', async () => {
    const h = harness()
    expect((await startRun(h.deps, {})).ok).toBe(true)
    const again = await startRun(h.deps, {})
    expect(again.ok).toBe(false)
    expect(!again.ok && again.message).toContain('already running')
    expect(h.mem.state!.runId).toBe('run1')
  })
  it('two simultaneous starts: exactly one wins', async () => {
    const h = harness()
    const [a, b] = await Promise.all([startRun(h.deps, {}), startRun(h.deps, {})])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
  })
  it('two overlapping steps of the same run: one is refused as busy', async () => {
    const h = harness()
    await startRun(h.deps, {})
    const [a, b] = await Promise.all([runStep(h.deps, { runId: 'run1', maxPeriods: 4 }), runStep(h.deps, { runId: 'run1', maxPeriods: 4 })])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    const lost = a.ok ? b : a
    expect(!lost.ok && lost.reason).toBe('busy')
    expect(h.mem.periods.size).toBe(4)                             // the batch ran once
  })
  it('the lease is released after a step and expires on its own if a step dies', async () => {
    const h = harness()
    await startRun(h.deps, {})
    await runStep(h.deps, { runId: 'run1', maxPeriods: 1 })
    expect(JSON.parse(h.mem.lock!).leaseUntil).toBe(0)
    await h.mem.store.casLock(h.mem.lock, { runId: 'run1', leaseUntil: h.clock.t + 6 * 60_000, at: '' })   // a step that died holding it
    expect((await runStep(h.deps, { runId: 'run1' })).ok).toBe(false)
    h.clock.t += 6 * 60_000 + 1
    expect((await runStep(h.deps, { runId: 'run1', maxPeriods: 1 })).ok).toBe(true)
  })
  it('a stalled run can be replaced, and the old run can no longer write', async () => {
    const h = harness()
    await startRun(h.deps, {})
    await runStep(h.deps, { runId: 'run1', maxPeriods: 4 })
    h.clock.t += STALL_MS + 1
    const second = await startRun(h.deps, {})
    expect(second.ok && second.state.runId).toBe('run2')
    const old = await runStep(h.deps, { runId: 'run1' })
    expect(!old.ok && old.reason).toBe('not_current')
  })
})

// ---- Skip if stored ---------------------------------------------------------------------------------------------
describe('skip if stored', () => {
  it('a second run skips every stored and settled period and re-pulls only the current month and unsettled periods', async () => {
    const h = harness()
    await startRun(h.deps, {})
    await h.drive('run1')
    const before = h.fake.calls.length
    const st = await startRun(h.deps, {})
    expect(st.ok).toBe(true)
    const s = st.ok ? st.state : null!
    const pending = s.periods.filter(p => p.status === 'pending')
    expect(pending.map(p => p.id).sort()).toEqual(['month:2026-11', 'week:2026-11-01', 'week:2026-11-08'])
    expect(pending.find(p => p.id === 'month:2026-11')!.reason).toBe('not settled yet')
    for (const p of s.periods.filter(x => x.status === 'skipped')) expect(isSettled(p.end, THROUGH, p.partial)).toBe(true)
    expect(count(s, 'skipped')).toBe(69)
    await h.drive('run2')
    const pulled = h.fake.calls.slice(before).filter(c => c.name === 'get_dashboard_performance_overview' && c.args.startDate !== '2025-10-01')
    expect(pulled.map(c => c.args.startDate).sort()).toEqual(['2026-11-01', '2026-11-01', '2026-11-08'])
    expect(h.mem.published).toHaveLength(2)
  })
  it('force_refresh re-pulls everything', async () => {
    const h = harness()
    await startRun(h.deps, {}); await h.drive('run1')
    const st = await startRun(h.deps, { forceRefresh: true })
    expect(st.ok && count(st.state, 'pending')).toBe(72)
  })
  it('the current partial month is re-pulled even when it is already stored', async () => {
    const h = harness()
    await h.mem.store.savePeriods([{ period_type: 'month', period_key: '2026-11', start_date: '2026-11-01', end_date: '2026-11-14', raw: { shopGmv: 1 }, raw_version: 3, final: false }])
    const st = await startRun(h.deps, {})
    expect(st.ok && st.state.periods.find(p => p.id === 'month:2026-11')).toMatchObject({ status: 'pending', end: THROUGH })
  })
})

// ---- No data ----------------------------------------------------------------------------------------------------
describe('no data is stored as no data, never zero', () => {
  it('a period Euka cannot return keeps nulls, carries the reason, and the run alerts when it finishes with missing periods', async () => {
    const h = harness({ dataFrom: '2025-11-02' })
    await startRun(h.deps, {})
    const { r } = await h.drive('run1')
    const s = r.state!
    expect(s.status).toBe('done')
    const oct = s.periods.find(p => p.id === 'month:2025-10')!
    expect(oct.status).toBe('no_data')
    expect(oct.reason).toContain('TikTok data retention')
    const raw = h.mem.periods.get('month:2025-10')!.raw
    for (const f of ['shopGmv', 'videos', 'eukaMessages', 'targetInvites', 'emails', 'gmvMaxSpend'] as const) expect(raw[f]).toBeNull()
    const cell = h.mem.published[0].scorecard.monthly.find(m => m.key === '2025-10')!.lines.gmv
    expect(cell).toMatchObject({ value: null, source: 'none' })
    expect(s.summary!.noData.map(n => n.id)).toEqual(expect.arrayContaining(['week:2025-10-05', 'week:2025-10-26', 'month:2025-10']))
    // four October weeks, October, and November 2025 (one day missing: a partial sum is never stored)
    expect(s.summary!.noData).toHaveLength(6)
    expect(s.periods.find(p => p.id === 'month:2025-11')!.reason).toContain('29 of 30 days have data')
    expect(h.mem.periods.get('month:2025-11')!.raw.shopGmv).toBeNull()
    expect(h.sent.map(x => x.kind)).toEqual(['MISSING'])
    expect(h.sent[0].text).toContain('6 period(s) have missing data')
  })
  it('a failed overview call is stored as partial and not final, so the next run retries it', async () => {
    const h = harness({ overviewFails: a => a === '2026-06-07' })
    await startRun(h.deps, {})
    const { r } = await h.drive('run1')
    const p = r.state!.periods.find(x => x.id === 'week:2026-06-07')!
    expect(p.status).toBe('partial')
    expect(p.reason).toContain('overview call failed')
    const stored = h.mem.periods.get('week:2026-06-07')!
    expect(stored.final).toBe(false)
    expect(stored.raw.samplesApproved).toBeNull()
    const again = await startRun(h.deps, {})
    expect(again.ok && again.state.periods.find(x => x.id === 'week:2026-06-07')!.status).toBe('pending')
  })
  it('before TikTok GMV history starts, GMV is no data but the counts Euka does have are kept; a 0 there is not stored as zero', async () => {
    const h = harness()
    // Live shape, May 2026: range truncated, GMV null, samples and creators real. October 2025: zeros.
    const live: EukaLike = { call: async (n, a: any = {}) => {
      const out = await h.fake.e.call(n, a)
      if (n === 'get_dashboard_performance_overview' && a.startDate === '2026-05-01') return { ...out, performanceRangeCoverage: { isTruncated: true }, totalShopGMV: null, samplesApproved: 69, activeCreators: 125 }
      if (n === 'get_dashboard_performance_overview' && a.startDate === '2025-10-01' && a.endDate === '2025-10-31') return { ...out, performanceRangeCoverage: { isTruncated: true }, totalShopGMV: null, samplesApproved: 0, activeCreators: 52 }
      return out
    } }
    const deps = { ...h.deps, euka: async () => live }
    await startRun(deps, {})
    let r = await runStep(deps, { runId: 'run1' })
    while (r.ok && r.state.status === 'running') r = await runStep(deps, { runId: 'run1' })
    expect(h.mem.periods.get('month:2026-05')!.raw).toMatchObject({ samplesApproved: 69, creatorsPosted: 125 })
    expect(h.mem.periods.get('month:2025-10')!.raw).toMatchObject({ samplesApproved: null, creatorsPosted: 52 })
  })
  it('periods stored under the old rule are re-pulled once', async () => {
    const h = harness()
    await h.mem.store.savePeriods([{ period_type: 'month', period_key: '2026-05', start_date: '2026-05-01', end_date: '2026-05-31', raw: { shopGmv: null }, raw_version: 1, final: true }])
    const st = await startRun(h.deps, {})
    expect(st.ok && st.state.periods.find(p => p.id === 'month:2026-05')).toMatchObject({ status: 'pending', reason: 'definition changed' })
  })
  it('classify reports days missing from the daily series', () => {
    const p: StoredPeriod = { period_type: 'week', period_key: '2026-05-03', start_date: '2026-05-03', end_date: '2026-05-09', raw: { shopGmv: 10, videos: null, eukaMessages: 5, targetInvites: 1, emails: 1, samplesApproved: 1, creatorsPosted: 1, gmvMaxSpend: 1, gmvMaxRevenue: 1, views: 1 }, raw_version: 1, final: true }
    const c = classify(p, { truncated: false, control: { shopGmv: 10, videos: null } }, ['videos 2026-05-03..2026-05-09: 6 of 7 days have data'])
    expect(c.status).toBe('partial'); expect(c.nullFields).toEqual(['videos']); expect(c.reason).toContain('6 of 7 days')
  })
})

// ---- Monday run -------------------------------------------------------------------------------------------------
describe('Monday run (weekly scope)', () => {
  const full = async () => { const h = harness(); await startRun(h.deps, {}); await h.drive('run1'); return h }
  it('pulls only the latest week and the month to date once history is stored', async () => {
    const h = await full()
    const st = await startRun(h.deps, { scope: 'weekly', trigger: 'cron' })
    const pending = st.ok ? st.state.periods.filter(p => p.status === 'pending') : []
    expect(pending.map(p => [p.id, p.reason])).toEqual([['week:2026-11-08', 'latest week'], ['month:2026-11', 'month to date']])
    const before = h.fake.calls.length
    await h.drive('run2')
    expect(h.fake.calls.slice(before).filter(c => c.name === 'get_dashboard_performance_overview').map(c => c.args.startDate).sort()).toEqual(['2025-10-01', '2026-11-01', '2026-11-08'])
    expect(h.mem.published).toHaveLength(2)
  })
  it('pulls last month as final once it is 3 days past its end, then never again', async () => {
    const h = await full()
    // October was stored on Nov 16 by the full run, already past Nov 3, so it is final
    expect(h.mem.periods.get('month:2026-10')!.final).toBe(true)
    // Roll forward to Dec 2 (a day before the 3rd): November is finished but not final yet, so it is not re-pulled as final
    const d2 = { ...h.deps, today: () => '2026-12-02' }
    h.clock.t += 20 * 86400000
    let st = await startRun(d2, { scope: 'weekly' })
    expect(st.ok && st.state.periods.find(p => p.id === 'month:2026-11')!.status).toBe('skipped')
    let r = await runStep(d2, { runId: st.ok ? st.state.runId : '' }); while (r.ok && r.state.status === 'running') r = await runStep(d2, { runId: r.state.runId })
    expect(h.mem.periods.get('month:2026-11')!.final).toBe(false)
    // Dec 7, the first Monday on or after the 3rd: November is pulled as final
    const d7 = { ...h.deps, today: () => '2026-12-07' }
    h.clock.t += 5 * 86400000
    st = await startRun(d7, { scope: 'weekly' })
    expect(st.ok && st.state.periods.find(p => p.id === 'month:2026-11')).toMatchObject({ status: 'pending', reason: 'month final (3 days after month end)' })
    r = await runStep(d7, { runId: st.ok ? st.state.runId : '' }); while (r.ok && r.state.status === 'running') r = await runStep(d7, { runId: r.state.runId })
    expect(h.mem.periods.get('month:2026-11')).toMatchObject({ final: true, end_date: '2026-11-30' })
    // The next Monday leaves it alone
    const d14 = { ...h.deps, today: () => '2026-12-14' }
    h.clock.t += 7 * 86400000
    st = await startRun(d14, { scope: 'weekly' })
    expect(st.ok && st.state.periods.find(p => p.id === 'month:2026-11')!.status).toBe('skipped')
    expect(st.ok && st.state.periods.filter(p => p.status === 'pending').map(p => p.id)).toEqual(['week:2026-12-06', 'month:2026-12'])
  })
  it('fills a recent week that a missed run left out, and everything when nothing is stored', async () => {
    const h = await full()
    h.mem.periods.delete('week:2026-10-25')
    const st = await startRun(h.deps, { scope: 'weekly' })
    expect(st.ok && st.state.periods.find(p => p.id === 'week:2026-10-25')).toMatchObject({ status: 'pending', reason: 'not stored yet' })
    const empty = harness()
    const st2 = await startRun(empty.deps, { scope: 'weekly' })
    expect(st2.ok && count(st2.state, 'pending')).toBe(72)
  })
  it('re-pulls periods stored under an older definition', async () => {
    const h = await full()
    const old = h.mem.periods.get('week:2026-03-01')!
    h.mem.periods.set('week:2026-03-01', { ...old, raw_version: 1 })
    const st = await startRun(h.deps, { scope: 'weekly' })
    expect(st.ok && st.state.periods.find(p => p.id === 'week:2026-03-01')).toMatchObject({ status: 'pending', reason: 'definition changed' })
  })
})

describe('usage rights', () => {
  it('reads every page, a few at a time, and counts each creator once', async () => {
    const h = harness()
    const pages: number[] = []
    const many: EukaLike = { call: async (n, a: any = {}) => {
      if (n !== 'search_usage_rights_requests') return h.fake.e.call(n, a)
      pages.push(a.page)
      const items = Array.from({ length: a.page <= 82 ? (a.page === 82 ? 84 : 100) : 0 }, (_, i) => ({ creator: { id: `c${((a.page - 1) * 100 + i) % 900}` } }))
      return { items, total: 8184 }
    } }
    const deps = { ...h.deps, euka: async () => many }
    await startRun(deps, { mode: 'proof' })
    let r = await runStep(deps, { runId: 'run1' }); while (r.ok && r.state.status === 'running') r = await runStep(deps, { runId: 'run1' })
    expect(pages.sort((x, y) => x - y)).toEqual(Array.from({ length: 82 }, (_, i) => i + 1))
    expect(h.mem.state!.prep.usageNow).toBe(900)
  })
})

// ---- Euka Chat (line 7) -----------------------------------------------------------------------------------------
describe('Euka Chat messages sent', () => {
  it('counts only team-sent Euka Chat messages, by Los Angeles day; no data before the first one, a real 0 after', async () => {
    const h = harness()
    await startRun(h.deps, {})
    await h.drive('run1')
    const raw = (id: string) => h.mem.periods.get(id)!.raw.eukaMessages
    expect(raw('week:2026-11-08')).toBe(3)        // two on Nov 10 and the late-evening Nov 14 one; the creator message and the note are not counted
    expect(raw('week:2026-11-01')).toBe(1)
    expect(raw('month:2026-11')).toBe(4)
    expect(raw('month:2026-06')).toBe(1)
    expect(raw('month:2026-07')).toBe(0)          // Euka Chat was in use, nothing sent: a real zero
    expect(raw('month:2026-05')).toBeNull()       // before the first Euka Chat message: no data, not zero
    expect(h.mem.published[0].scorecard.monthly.find(m => m.key === '2026-05')!.lines.eukaMessages).toMatchObject({ value: null, source: 'none' })
  })
  it('a later run reads only conversations with new activity', async () => {
    const h = harness()
    await startRun(h.deps, {}); await h.drive('run1')
    const timelines = () => h.fake.calls.filter(c => c.name === 'list_inbox_thread_timeline').length
    expect(timelines()).toBe(2)
    await startRun(h.deps, {}); await h.drive('run2')
    expect(timelines()).toBe(2)                   // nothing changed, nothing re-read
    const h2 = harness({ chatThreads: [{ ...CHAT_THREADS[0], at: 99, items: [...CHAT_THREADS[0].items, msg('2026-11-12T18:00:00Z', 'Manager')] }, CHAT_THREADS[1]] })
    await h2.mem.store.saveChatCache({ t1: { at: 1, days: { '2026-11-10': 2 } }, t2: { at: 2, days: { '2026-06-15': 1 } } })
    await startRun(h2.deps, {}); await h2.drive('run1')
    expect(h2.fake.calls.filter(c => c.name === 'list_inbox_thread_timeline').map(c => c.args.threadId)).toEqual(['t1'])
    expect(h2.mem.periods.get('week:2026-11-08')!.raw.eukaMessages).toBe(4)
  })
  it('with no Euka Chat history at all the line is no data everywhere', () => {
    expect(eukaChatFor({})('2026-11-08', '2026-11-14')).toBeNull()
  })
})

// ---- Audit fix brief (2026-11-17) --------------------------------------------------------------------------------
describe('fix brief item 1: line 7 never mirrors the automated outreach count', () => {
  it('stores the Euka Chat count, not the dashboard messagesSent', async () => {
    const h = harness()
    await startRun(h.deps, {}); await h.drive('run1')
    // The fake dashboard reports 700 automated messages for the week; Euka Chat has 3 team messages
    expect(h.mem.periods.get('week:2026-11-08')!.raw.eukaMessages).toBe(3)
    for (const p of h.mem.periods.values()) expect(p.raw_version).toBe(3)
  })
  it('with no Euka Chat conversations the line is no data in every period, never the automated count', async () => {
    const h = harness({ chatThreads: [] })
    await startRun(h.deps, {}); await h.drive('run1')
    for (const p of h.mem.periods.values()) expect(p.raw.eukaMessages).toBeNull()
  })
})

describe('fix brief item 2: stall, resume and counters', () => {
  it('a run with no progress ends as stalled, not running, and resumes from what is saved', async () => {
    const h = harness()
    await startRun(h.deps, {})
    await runStep(h.deps, { runId: 'run1', maxPeriods: 4 })
    h.clock.t += STALL_MS + 1000
    const s = await checkStall(h.deps)
    expect(s).toMatchObject({ status: 'stalled' })
    expect(s!.finishedAt).toBeTruthy()
    expect(s!.lastError!.nextStep).toContain('Resume')
    expect((await runStep(h.deps, { runId: 'run1' })).ok).toBe(false)        // a stalled run does not quietly carry on
    const r = await resumeRun(h.deps)
    expect(r.ok && r.state.status).toBe('running')
    expect((await h.drive('run1')).r.state!.status).toBe('done')
    expect(h.mem.periods.size).toBe(72)
  })
  it('a run already marked as alerted (older state) still ends as stalled, without a second alert', async () => {
    const h = harness()
    await startRun(h.deps, {})
    await h.mem.store.writeState({ ...h.mem.state!, stallAlerted: true })
    h.clock.t += STALL_MS + 1000
    expect((await checkStall(h.deps))!.status).toBe('stalled')
    expect(h.sent).toHaveLength(0)
  })
  it('the alert, the summary and the state all report the same counts', async () => {
    const h = harness()
    await startRun(h.deps, {}); await h.drive('run1')
    await startRun(h.deps, {})                                             // second run: 69 already stored, 3 to pull
    await runStep(h.deps, { runId: 'run2', maxPeriods: 1 })
    h.clock.t += STALL_MS + 1000
    const s = (await checkStall(h.deps))!
    const c = runCounts(s)
    expect(c).toMatchObject({ total: 72, pulled: 1, alreadyStored: 69, remaining: 2, finished: 70 })
    expect(h.sent[0].text).toContain('70 of 72 periods are finished (1 pulled in this run, 69 already stored), 2 remaining')
    expect(c.pulled + c.alreadyStored + c.remaining).toBe(c.total)
  })
  it('a run that was planned before a definition change re-plans instead of skipping old rows', async () => {
    const h = harness()
    // Old rows in the store, and a run in flight whose plan (made under version 1) skipped them
    const st = await startRun(h.deps, {}); await h.drive('run1')
    for (const [k, p] of h.mem.periods) h.mem.periods.set(k, { ...p, raw_version: 1, raw: { ...p.raw, eukaMessages: 38182 } })
    await startRun(h.deps, {})
    const frozen = { ...h.mem.state!, rawVersion: 1, periods: h.mem.state!.periods.map(p => ({ ...p, status: 'skipped' as const, reason: 'already stored and settled' })) }
    await h.mem.store.writeState(frozen)
    const { r } = await h.drive('run2')
    expect(st.ok).toBe(true)
    expect(r.state!.status).toBe('done')
    for (const p of h.mem.periods.values()) { expect(p.raw_version).toBe(3); expect(p.raw.eukaMessages).not.toBe(38182) }
    expect(runCounts(r.state!)).toMatchObject({ pulled: 72, alreadyStored: 0, remaining: 0 })
  })
})

describe('fix brief item 4: health reflects the store and the run, not only the arithmetic', () => {
  const ok: HealthInput = { scorecardAudit: 'PASS', missingFromStore: [], outdatedDefinition: [], lastRun: { status: 'done', lastProgress: '2026-11-17T05:00:00Z' }, publishedAt: '2026-11-17T05:00:00Z', newestPulledAt: '2026-11-17T04:59:00Z', line7Periods: 40, eukaChatConversations: 246, alerts: { slack: true, email: true, missing: [] }, cronReady: true }
  it('passes when everything is in order', () => expect(scorecardHealth(ok)).toEqual({ status: 'PASS', problems: [] }))
  it('fails on missing periods, old definitions, a stalled or failed run, a store newer than the published scorecard, and an empty Euka Chat input', () => {
    expect(scorecardHealth({ ...ok, missingFromStore: ['week 2026-06-28'] }).status).toBe('FAIL')
    expect(scorecardHealth({ ...ok, outdatedDefinition: ['week 2026-11-08 (v1)'] }).status).toBe('FAIL')
    expect(scorecardHealth({ ...ok, lastRun: { status: 'stalled', lastProgress: 'x' } }).status).toBe('FAIL')
    expect(scorecardHealth({ ...ok, lastRun: { status: 'failed', lastProgress: 'x', message: 'boom' } }).status).toBe('FAIL')
    expect(scorecardHealth({ ...ok, publishedAt: '2026-11-17T03:46:18Z', newestPulledAt: '2026-11-17T03:57:00Z' }).status).toBe('FAIL')
    expect(scorecardHealth({ ...ok, eukaChatConversations: 0 }).problems[0].text).toContain('not Euka Chat counts')
  })
  it('fails when no alert channel is set up and names the variables; warns when only one is', () => {
    const none = scorecardHealth({ ...ok, alerts: { slack: false, email: false, missing: ['SLACK_WEBHOOK_URL', 'RESEND_API_KEY', 'ALERT_EMAIL_FROM'] } })
    expect(none.status).toBe('FAIL'); expect(none.problems[0].text).toContain('SLACK_WEBHOOK_URL, RESEND_API_KEY, ALERT_EMAIL_FROM')
    expect(scorecardHealth({ ...ok, alerts: { slack: true, email: false, missing: ['RESEND_API_KEY'] } }).status).toBe('WARN')
  })
  it('the production state from the audit export is a FAIL', () => {
    const h = scorecardHealth({ ...ok, missingFromStore: Array(39).fill('week x'), outdatedDefinition: Array(33).fill('week y (v1)'), lastRun: { status: 'stalled', lastProgress: '2026-11-17T04:05:57Z' }, publishedAt: '2026-11-17T03:46:18Z', newestPulledAt: '2026-11-17T03:57:00Z', eukaChatConversations: 0, alerts: { slack: false, email: false, missing: ['SLACK_WEBHOOK_URL'] } })
    expect(h.status).toBe('FAIL'); expect(h.problems.filter(p => p.level === 'FAIL')).toHaveLength(6)
  })
})

describe('fix brief item 5: the month in progress is cut per line at its own last day', () => {
  it('shop GMV one day behind: the month shows GMV through that day and estimates from its own days', async () => {
    const h = harness({ shopGmvThrough: '2026-11-14' })                  // data through Nov 15, shop GMV only through Nov 14
    await startRun(h.deps, {}); await h.drive('run1')
    const nov = h.mem.periods.get('month:2026-11')!.raw
    const expected = Array.from({ length: 14 }, (_, i) => 1000 + i + 1).reduce((a, b) => a + b, 0)
    expect(nov.shopGmv).toBe(expected)                                    // was null before the fix
    expect(nov.through).toEqual({ shopGmv: '2026-11-14' })
    expect(nov.videos).toBe(150)                                          // lines with data through Nov 15 are unchanged
    const m = h.mem.published[0].scorecard.monthly[0]
    expect(m.through).toEqual({ gmv: '2026-11-14' })
    expect(m.lines.gmv).toMatchObject({ value: expected, note: 'through 2026-11-14' })
    expect(m.projected!.gmv).toBe(Math.round((expected / 14) * 30 * 100) / 100)     // 14 days of data, not 15
    expect(m.projected!.videos).toBe(300)                                           // 150 over 15 days
    expect(auditScorecard(h.mem.published[0].scorecard).status).toBe('PASS')
  })
  it('a finished period keeps the strict rule: a missing day is still no data', async () => {
    const h = harness({ shopGmvThrough: '2026-10-30' })
    await startRun(h.deps, {}); await h.drive('run1')
    expect(h.mem.periods.get('month:2026-10')!.raw.shopGmv).toBeNull()
    expect(h.mem.periods.get('month:2026-10')!.raw.through).toBeUndefined()
    expect(h.mem.periods.get('week:2026-10-25')!.raw.shopGmv).toBeNull()
  })
  it('a gap in the middle of the month in progress is still no data', async () => {
    const h = harness()
    const gap: EukaLike = { call: async (n, a: any = {}) => { const out = await h.fake.e.call(n, a); if (n === 'get_dashboard_performance_series') out.data.performances = out.data.performances.filter((r: any) => r.date !== '2026-11-06'); return out } }
    const deps = { ...h.deps, euka: async () => gap }
    await startRun(deps, {}); let r = await runStep(deps, { runId: 'run1' }); while (r.ok && r.state.status === 'running') r = await runStep(deps, { runId: 'run1' })
    expect(h.mem.periods.get('month:2026-11')!.raw.shopGmv).toBeNull()
  })
})

// ---- Stall ------------------------------------------------------------------------------------------------------
describe('stall alert', () => {
  it('alerts once after 10 minutes with no progress, and not before', async () => {
    const h = harness()
    await startRun(h.deps, {})
    await runStep(h.deps, { runId: 'run1', maxPeriods: 4 })
    h.clock.t += STALL_MS - 1000
    await checkStall(h.deps); expect(h.sent).toHaveLength(0)
    h.clock.t += 2000
    await checkStall(h.deps); await checkStall(h.deps)
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].kind).toBe('STALLED')
    expect(h.sent[0].text).toContain('click Resume')
    expect(h.sent[0].text).toContain('4 of 72 periods')
  })
  it('a finished run never raises a stall alert', async () => {
    const h = harness()
    await startRun(h.deps, {}); await h.drive('run1')
    h.clock.t += STALL_MS * 3
    await checkStall(h.deps)
    expect(h.sent).toHaveLength(0)
  })
})
