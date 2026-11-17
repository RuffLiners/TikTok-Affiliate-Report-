import { describe, expect, it } from 'vitest'
import { addDays, buildTodo, ManualEntry, Scorecard, ScorecardRaw } from '../index'
import {
  AlertRecord, BackfillState, BackfillStore, Deps, LockRec, STALL_MS, backfillWanted, cancelRun, checkStall, classify, firstFullWeekStart,
  nextBatch, resumeRun, runStep, startRun,
} from './backfill'
import { StoredPeriod, isSettled } from './plan'
import { ContestMonth } from './contests'
import { EukaLike } from './pull'

const TODAY = '2026-11-16', THROUGH = '2026-11-15'

// ---- Fakes ------------------------------------------------------------------------------------------------------
function memoryStore() {
  let lock: string | null = null
  let state: BackfillState | null = null
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
    async publish(asOf, raw, scorecard, audit) { published.push({ asOf, raw, scorecard, audit }) },
  }
  return { store, periods, published, get lock() { return lock }, get state() { return state } }
}

interface FakeOpts { dataFrom?: string; failSeries?: (start: string, end: string) => boolean; overviewFails?: (start: string, end: string) => boolean }
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
          performances: ds.map(date => ({ date, total_shop_gmv: gmv(date) })),
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
      shopGmv: 77338.52, gmvMaxSpend: 23909.06, gmvMaxRevenue: 89159.16, targetInvites: 59587, emails: 845, eukaMessages: 38182,
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
    await h.mem.store.savePeriods([{ period_type: 'month', period_key: '2026-11', start_date: '2026-11-01', end_date: '2026-11-14', raw: { shopGmv: 1 }, raw_version: 2, final: false }])
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
    const c = classify(p, { truncated: false, control: { shopGmv: 10, eukaMessages: 5, videos: null } }, ['videos 2026-05-03..2026-05-09: 6 of 7 days have data'])
    expect(c.status).toBe('partial'); expect(c.nullFields).toEqual(['videos']); expect(c.reason).toContain('6 of 7 days')
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
