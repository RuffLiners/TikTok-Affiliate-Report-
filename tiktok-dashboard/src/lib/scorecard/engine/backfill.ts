// Resumable scorecard backfill. Runs the same planning, pulling, building and audit code as the GitHub run, but in
// bounded steps that each fit inside one server function call. Storage, the Euka client and alerts are injected, so
// the whole flow is unit-tested with fakes. No metric definition lives here.
import {
  LAUNCH_DATE, ManualEntry, RangeRaw, Scorecard, ScorecardRaw, addDays, addMonths, auditScorecard, buildScorecard, buildTodo, dayOfWeek, monthEnd, monthOf, monthStart, weekRanges,
} from '../index'
import { RAW_VERSION, StoredPeriod, Wanted, planPulls, wantedPeriods } from './plan'
import { ContestInfo, ContestMonth, contestCounts, contestFor, countsAsContest, resolveContestMonths } from './contests'
import { ADS_HISTORY_FROM, EukaLike, PeriodDiag, VIEWS_FROM, assembleRaw, fetchContestIds, listContests, pullDaily, pullOverview, pullPeriods, pullUsageRightsNow } from './pull'
import type { DailyMap } from './daily'

export const DEFAULT_YEAR_START = '2025-10-01'
/** A run with no progress for this long is stalled: it alerts and can be resumed or replaced. */
export const STALL_MS = 10 * 60 * 1000
/** A step holds the lock this long at most. Longer than the function time limit, so a crashed step frees itself. */
export const LEASE_MS = 6 * 60 * 1000
/** Stop starting new batches after this long inside one step. */
export const STEP_BUDGET_MS = 150 * 1000
/** One pull batch is a calendar month plus the weeks that end in it (at most 5), so one month of daily rows serves them all. */
export const BATCH_MAX_PERIODS = 6

export type PeriodStatus = 'pending' | 'skipped' | 'stored' | 'partial' | 'no_data' | 'error'
export interface PeriodProgress {
  id: string; type: 'week' | 'month'; key: string; start: string; end: string; partial: boolean
  status: PeriodStatus
  /** Why it is pending or skipped, why it has no data, or the error text. */
  reason?: string
  /** Raw fields Euka returned nothing for. */
  nullFields?: string[]
  /** Range-level totals that differ from the daily sums (information only). */
  controlDiffs?: string[]
  pulledAt?: string
}
export interface AlertRecord { at: string; kind: 'FAILED' | 'STALLED' | 'MISSING'; text: string; slack: string; email: string }
export interface BackfillSummary {
  weeksStored: number; monthsStored: number; reused: number
  noData: Array<{ id: string; label: string; reason: string }>
  partial: Array<{ id: string; label: string; reason: string }>
  controlDiffs: string[]
  cofundedTodo: { weeks: number; months: number; text: string }
  currentMonth: { key: string; daysElapsed: number; daysInMonth: number; mtdGmv: number | null; projectedGmv: number | null } | null
  publishedAsOf: string
  auditWarnings: number
  /** Proof mode only: the raw values stored for the one week, to check against Euka. */
  proof?: { label: string; start: string; end: string; raw: RangeRaw; gmvMaxRoi: number | null }
}
export interface BackfillState {
  runId: string
  status: 'running' | 'failed' | 'done' | 'cancelled'
  /** full = the whole history. proof = the most recent complete week only, to prove the path end to end. */
  mode: 'full' | 'proof'
  /** Who started it. A cron run is continued by the watchdog if one call was not enough. */
  trigger?: 'manual' | 'cron'
  yearStart: string
  /** First Sunday on or after yearStart: the first full week covered. */
  weeksFrom: string
  forceRefresh: boolean
  asOf: string
  dataThrough: string
  startedAt: string
  /** Time of the last real progress. Drives the stall check. */
  updatedAt: string
  finishedAt?: string
  phase: 'prep' | 'pull' | 'publish' | 'done'
  prep: { contestMonthsDone: string[]; usageNow: number | null; done: boolean }
  periods: PeriodProgress[]
  current: string | null
  lastError?: { at: string; period: string | null; message: string; nextStep: string }
  alerts: AlertRecord[]
  stallAlerted: boolean
  summary?: BackfillSummary
}
export interface LockRec { runId: string; leaseUntil: number; at: string }

export interface BackfillStore {
  /** `raw` is the exact stored text, used for compare-and-swap. */
  readLock(): Promise<{ raw: string; rec: LockRec } | null>
  /** Atomic: succeeds only if the stored lock still equals `expectedRaw` (null = no lock row). */
  casLock(expectedRaw: string | null, next: LockRec): Promise<boolean>
  readState(): Promise<BackfillState | null>
  writeState(s: BackfillState): Promise<void>
  loadPeriods(): Promise<StoredPeriod[]>
  savePeriods(p: StoredPeriod[]): Promise<void>
  loadContestMonths(): Promise<ContestMonth[]>
  saveContestMonths(m: ContestMonth[]): Promise<void>
  loadSnapshots(key: string): Promise<Array<{ snap_date: string; value: number }>>
  loadManual(): Promise<ManualEntry[]>
  publish(asOf: string, raw: ScorecardRaw, scorecard: Scorecard, audit: { status: string; failures: string[]; warnings: string[] }): Promise<void>
}
export type Notify = (kind: AlertRecord['kind'], text: string) => Promise<{ slack: string; email: string }>
export interface Deps {
  store: BackfillStore
  /** Opens a Euka client. Called once per step, only when a pull is needed. */
  euka: () => Promise<EukaLike & { close?: () => Promise<void> }>
  notify: Notify
  now: () => number
  /** Today in America/Los_Angeles, YYYY-MM-DD. */
  today: () => string
  newId?: () => string
}

const iso = (t: number) => new Date(t).toISOString()
const idOf = (w: { type: string; key: string }) => `${w.type}:${w.key}`
export const periodLabel = (p: { type: string; key: string; start: string; end: string; partial: boolean }) =>
  p.type === 'week' ? `Week ${p.start} to ${p.end}` : p.partial ? `${p.key} month to date (through ${p.end})` : `Month ${p.key}`

/** First Sunday on or after a date: the start of the first full Sunday to Saturday week. */
export const firstFullWeekStart = (date: string) => addDays(date, (7 - dayOfWeek(date)) % 7)

/**
 * Coverage rule: every Sunday to Saturday week from the first full week on or after yearStart through the last
 * complete week, and every month from launch (2025-10) through the current month (month to date).
 * Weeks newest first, then months newest first.
 */
export function backfillWanted(asOf: string, dataThrough: string, yearStart: string): Wanted[] {
  const from = firstFullWeekStart(yearStart)
  const all = wantedPeriods(asOf, dataThrough, from)
  return [...all.filter(w => w.type === 'week' && w.start >= from), ...all.filter(w => w.type === 'month')]
}

/**
 * The next group to pull together: the newest month that still has work, with the weeks that end in it. They share
 * the same days, so the daily series is fetched once for all of them instead of once for weeks and again for months.
 */
export function nextBatch(pending: Wanted[], maxPeriods = BATCH_MAX_PERIODS): Wanted[] {
  if (!pending.length) return []
  const anchor = monthOf(pending.reduce((m, w) => (w.end > m ? w.end : m), pending[0].end))
  return pending.filter(w => monthOf(w.end) === anchor).slice(0, Math.max(1, maxPeriods))
}

const PULLED: PeriodStatus[] = ['stored', 'partial', 'no_data']

/**
 * Decide each period's status. Stored and settled periods are skipped exactly as plan.ts decides; the current partial
 * month and anything unsettled is pulled. Periods already pulled in this run are kept, so a resume does not repeat them.
 */
export function planPeriods(wanted: Wanted[], stored: StoredPeriod[], force: boolean, prior: PeriodProgress[] = [], sameDay = true): PeriodProgress[] {
  const priorBy = new Map(prior.map(p => [p.id, p]))
  const storedBy = new Map(stored.map(s => [`${s.period_type}:${s.period_key}`, s]))
  const normal = planPulls(wanted, stored, {})
  return wanted.map(w => {
    const id = idOf(w), was = priorBy.get(id), s = storedBy.get(id)
    const settledInStore = !!s && s.final && s.raw_version === RAW_VERSION
    if (was && PULLED.includes(was.status) && was.end === w.end && (sameDay || settledInStore)) return was
    const why = force ? 'forced refresh' : normal.reasons[id]
    const base = { id, type: w.type, key: w.key, start: w.start, end: w.end, partial: w.partial }
    return why ? { ...base, status: 'pending' as const, reason: why } : { ...base, status: 'skipped' as const, reason: 'already stored and settled' }
  })
}

const EXPECTED: Array<keyof RangeRaw> = ['shopGmv', 'targetInvites', 'emails', 'eukaMessages', 'videos', 'samplesApproved', 'creatorsPosted']
const SERIES: Array<keyof RangeRaw> = ['shopGmv', 'targetInvites', 'emails', 'eukaMessages', 'videos']

/** Classify a pulled period. Never fills a number: missing stays null and gets a reason. */
export function classify(p: StoredPeriod, diag: PeriodDiag | undefined, gaps: string[]): Pick<PeriodProgress, 'status' | 'reason' | 'nullFields' | 'controlDiffs'> {
  const raw = p.raw, a = p.start_date, b = p.end_date
  const expected: Array<keyof RangeRaw> = [...EXPECTED, ...(b >= ADS_HISTORY_FROM ? (['gmvMaxSpend', 'gmvMaxRevenue'] as const) : []), ...(b >= VIEWS_FROM ? (['views'] as const) : [])]
  const nullFields = expected.filter(f => raw[f] == null)
  const mine = gaps.filter(g => g.includes(`${a}..${b}`))
  const controlDiffs: string[] = []
  if (diag && !diag.overviewError && !diag.truncated) {
    const cmp = (f: 'shopGmv' | 'eukaMessages' | 'videos', tol: number) => {
      const c = diag.control[f], v = raw[f]
      if (c != null && v != null && Math.abs(c - v) > tol) controlDiffs.push(`${periodLabel({ type: p.period_type, key: p.period_key, start: a, end: b, partial: false })} ${f}: daily sum ${v} vs range total ${c}`)
    }
    cmp('shopGmv', 0.01); cmp('eukaMessages', 0); cmp('videos', 0)
  }
  const extra = controlDiffs.length ? { controlDiffs } : {}
  if (diag?.overviewError) {
    return { status: 'partial', reason: `Euka overview call failed after retries (${diag.overviewError}). Samples approved, creators posted and views are stored as no data and this period is re-pulled on the next run.`, nullFields, ...extra }
  }
  if (!nullFields.length) return { status: 'stored', ...extra }
  const why = [
    diag?.truncated ? 'Euka marked this range as cut short by TikTok data retention' : '',
    mine.length ? `days missing from the Euka daily series (${[...new Set(mine.map(g => g.split(': ').pop()))].join('; ')})` : '',
  ].filter(Boolean).join('; ') || 'Euka returned no rows for these dates'
  if (SERIES.every(f => raw[f] == null)) return { status: 'no_data', reason: `No data: ${why}.`, nullFields, ...extra }
  return { status: 'partial', reason: `No data for ${nullFields.join(', ')}: ${why}.`, nullFields, ...extra }
}

export type StartResult = { ok: true; state: BackfillState } | { ok: false; reason: 'locked'; message: string; state: BackfillState | null }

const isActive = (s: BackfillState | null, now: number) => !!s && s.status === 'running' && now - Date.parse(s.updatedAt) < STALL_MS

/** Start a new run. Refused while another run is making progress. Exactly one of two simultaneous starts wins. */
export async function startRun(d: Deps, o: { yearStart?: string; forceRefresh?: boolean; mode?: 'full' | 'proof'; trigger?: 'manual' | 'cron' } = {}): Promise<StartResult> {
  const now = d.now()
  const [lock, prev] = await Promise.all([d.store.readLock(), d.store.readState()])
  if (isActive(prev, now) || (lock && lock.rec.leaseUntil > now)) {
    return { ok: false, reason: 'locked', state: prev, message: `A backfill is already running (started ${prev?.startedAt ?? lock?.rec.at}, last progress ${prev?.updatedAt ?? 'unknown'}). Wait for it to finish, or resume it if it has stopped for 10 minutes.` }
  }
  const runId = (d.newId ?? (() => `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`))()
  if (!(await d.store.casLock(lock?.raw ?? null, { runId, leaseUntil: 0, at: iso(now) }))) {
    return { ok: false, reason: 'locked', state: await d.store.readState(), message: 'Another admin started a backfill at the same moment. Theirs is running; this one was not started.' }
  }
  const yearStart = o.yearStart || DEFAULT_YEAR_START
  const asOf = d.today(), dataThrough = addDays(asOf, -1), mode = o.mode ?? 'full', force = !!o.forceRefresh
  let wanted = backfillWanted(asOf, dataThrough, yearStart)
  if (mode === 'proof') wanted = wanted.filter(w => w.type === 'week').slice(0, 1)
  const stored = await d.store.loadPeriods()
  const state: BackfillState = {
    runId, status: 'running', mode, trigger: o.trigger ?? 'manual', yearStart, weeksFrom: firstFullWeekStart(yearStart), forceRefresh: force, asOf, dataThrough,
    startedAt: iso(now), updatedAt: iso(now), phase: 'prep', prep: { contestMonthsDone: [], usageNow: null, done: false },
    // A proof run always pulls its one week so there are fresh numbers to check
    periods: planPeriods(wanted, stored, force || mode === 'proof'), current: null, alerts: [], stallAlerted: false,
  }
  await d.store.writeState(state)
  return { ok: true, state }
}

/** Continue a run that failed, was cancelled or stalled. Periods already pulled in this run are not repeated. */
export async function resumeRun(d: Deps): Promise<StartResult> {
  const now = d.now()
  const [lock, prev] = await Promise.all([d.store.readLock(), d.store.readState()])
  if (!prev || prev.status === 'done') return { ok: false, reason: 'locked', state: prev, message: 'There is no unfinished backfill to resume. Start a new one.' }
  if (isActive(prev, now) || (lock && lock.rec.leaseUntil > now)) return { ok: false, reason: 'locked', state: prev, message: 'This backfill is still making progress. It can be resumed once it has stopped for 10 minutes.' }
  if (!(await d.store.casLock(lock?.raw ?? null, { runId: prev.runId, leaseUntil: 0, at: iso(now) }))) return { ok: false, reason: 'locked', state: prev, message: 'Another admin resumed this backfill at the same moment.' }
  const asOf = d.today(), dataThrough = addDays(asOf, -1), sameDay = asOf === prev.asOf
  let wanted = backfillWanted(asOf, dataThrough, prev.yearStart)
  if (prev.mode === 'proof') wanted = wanted.filter(w => w.type === 'week').slice(0, 1)
  const retry = prev.periods.map(p => (p.status === 'error' ? { ...p, status: 'pending' as const, reason: 'retry after error' } : p))
  const periods = planPeriods(wanted, await d.store.loadPeriods(), prev.forceRefresh || prev.mode === 'proof', retry, sameDay)
  const state: BackfillState = {
    ...prev, status: 'running', asOf, dataThrough, updatedAt: iso(now), finishedAt: undefined, stallAlerted: false, current: null, periods,
    phase: prev.prep.done && sameDay ? 'pull' : 'prep', prep: sameDay ? prev.prep : { contestMonthsDone: [], usageNow: null, done: false },
  }
  await d.store.writeState(state)
  return { ok: true, state }
}

export async function cancelRun(d: Deps): Promise<BackfillState | null> {
  const s = await d.store.readState()
  if (!s || s.status !== 'running') return s
  const next: BackfillState = { ...s, status: 'cancelled', finishedAt: iso(d.now()), current: null }
  await d.store.writeState(next)
  return next
}

async function sendAlert(d: Deps, s: BackfillState, kind: AlertRecord['kind'], text: string): Promise<void> {
  let res = { slack: 'failed: notifier threw', email: 'failed: notifier threw' }
  try { res = await d.notify(kind, text) } catch (e) { res = { slack: `failed: ${(e as Error).message}`, email: `failed: ${(e as Error).message}` } }
  s.alerts = [...s.alerts, { at: iso(d.now()), kind, text, ...res }].slice(-20)
}

/** Alert once when a running backfill has made no progress for 10 minutes. Safe to call from a cron or a page load. */
export async function checkStall(d: Deps): Promise<BackfillState | null> {
  const s = await d.store.readState()
  if (!s || s.status !== 'running' || s.stallAlerted) return s
  const idle = d.now() - Date.parse(s.updatedAt)
  if (idle < STALL_MS) return s
  const at = s.current ?? s.periods.find(p => p.status === 'pending')?.id ?? s.phase
  s.stallAlerted = true
  await sendAlert(d, s, 'STALLED', `The scorecard backfill has made no progress for ${Math.round(idle / 60000)} minutes. Stopped at: ${describe(s, at)}. ${done(s)} of ${s.periods.length} periods are finished. Next step: open the dashboard, Manage tab, Scorecard backfill, and click Resume.`)
  await d.store.writeState(s)
  return s
}

const done = (s: BackfillState) => s.periods.filter(p => p.status !== 'pending' && p.status !== 'error').length
const describe = (s: BackfillState, id: string | null) => { const p = s.periods.find(x => x.id === id); return p ? periodLabel(p) : (id ?? 'start of run') }

export type StepResult = { ok: true; state: BackfillState } | { ok: false; reason: 'not_current' | 'busy' | 'not_running'; message: string; state: BackfillState | null }

/**
 * Do one bounded piece of work: preparation (contests, usage rights), then pull batches until the time budget is
 * used, then build, audit and publish. Each batch is saved before the next starts, so nothing is lost if a step dies.
 */
export async function runStep(d: Deps, o: { runId: string; budgetMs?: number; maxPeriods?: number }): Promise<StepResult> {
  const t0 = d.now(), budget = o.budgetMs ?? STEP_BUDGET_MS
  const lock = await d.store.readLock()
  const s0 = await d.store.readState()
  if (!lock || !s0 || lock.rec.runId !== o.runId || s0.runId !== o.runId) return { ok: false, reason: 'not_current', state: s0, message: 'This run was replaced by a newer backfill. Reload the panel.' }
  const s: BackfillState = s0
  if (s.status !== 'running') return { ok: false, reason: 'not_running', state: s, message: s.status === 'done' ? 'This run has finished.' : `This run is ${s.status}. Use Resume to continue it.` }
  if (lock.rec.leaseUntil > t0) return { ok: false, reason: 'busy', state: s, message: 'Another step of this run is still in progress.' }
  const lease: LockRec = { runId: o.runId, leaseUntil: t0 + LEASE_MS, at: iso(t0) }
  if (!(await d.store.casLock(lock.raw, lease))) return { ok: false, reason: 'busy', state: s, message: 'Another step of this run started at the same moment.' }

  const conn: { e: (EukaLike & { close?: () => Promise<void> }) | null } = { e: null }
  const client = async () => (conn.e ??= await d.euka())
  const within = () => d.now() - t0 < budget
  const progress = async () => { s.updatedAt = iso(d.now()); s.stallAlerted = false; await d.store.writeState(s) }
  try {
    // ---- Preparation: monthly contest participants and the usage-rights count, saved as they are fetched
    if (s.phase === 'prep') {
      const e = await client()
      const contests: ContestInfo[] = await listContests(e, s.asOf)
      const months = [...new Set(contests.filter(countsAsContest).map(c => c.startDate.slice(0, 7)))].sort()
      const storedCm = s.forceRefresh ? [] : await d.store.loadContestMonths()
      for (const month of months) {
        if (s.prep.contestMonthsDone.includes(month)) continue
        if (!within()) { await progress(); return { ok: true, state: s } }
        s.current = `contests ${month}`
        const { fresh } = await resolveContestMonths(contests.filter(c => c.startDate.slice(0, 7) === month), storedCm, s.dataThrough, fetchContestIds(e, s.asOf))
        if (fresh.length) await d.store.saveContestMonths(fresh)
        s.prep.contestMonthsDone.push(month)
        await progress()
      }
      s.current = 'usage rights'
      s.prep.usageNow = await pullUsageRightsNow(e, s.asOf)
      s.prep.done = true; s.phase = 'pull'; s.current = null
      await progress()
    }

    // ---- Pull: bounded batches, each saved before the next
    let pulledThisStep = 0
    // Read once per step, not once per batch
    const counts = s.phase === 'pull' ? contestCounts(await d.store.loadContestMonths()) : null
    const usageSnaps = s.phase === 'pull' ? await d.store.loadSnapshots('usageRightsCreators') : []
    // Daily rows by calendar month, fetched once per step and shared by every batch that touches the month
    const monthDaily = new Map<string, Promise<DailyMap>>()
    const dailyFor = async (e: EukaLike, from: string, to: string): Promise<DailyMap> => {
      const keys: string[] = []
      for (let m = monthOf(from); m <= monthOf(to); m = addMonths(m, 1)) keys.push(m)
      const maps = await Promise.all(keys.map(m => {
        if (!monthDaily.has(m)) {
          const end = monthEnd(m) > s.dataThrough ? s.dataThrough : monthEnd(m)
          monthDaily.set(m, pullDaily(e, s.asOf, monthStart(m), end).catch(err => { monthDaily.delete(m); throw err }))
        }
        return monthDaily.get(m)!
      }))
      return Object.assign({}, ...maps)
    }
    while (s.phase === 'pull') {
      const pending = s.periods.filter(p => p.status === 'pending')
      if (!pending.length) { s.phase = 'publish'; break }
      if (!within() || (o.maxPeriods != null && pulledThisStep >= o.maxPeriods)) { await progress(); return { ok: true, state: s } }
      const cap = Math.min(BATCH_MAX_PERIODS, o.maxPeriods != null ? o.maxPeriods - pulledThisStep : BATCH_MAX_PERIODS)
      const batch = nextBatch(pending.map(p => ({ type: p.type, key: p.key, start: p.start, end: p.end, partial: p.partial })), cap)
      const ids = new Set(batch.map(idOf))
      s.current = idOf(batch[0])
      const e = await client()
      const gaps: string[] = []
      let pulled: Awaited<ReturnType<typeof pullPeriods>>
      try {
        const from = batch.reduce((m, w) => (w.start < m ? w.start : m), batch[0].start), to = batch.reduce((m, w) => (w.end > m ? w.end : m), batch[0].end)
        pulled = await pullPeriods(e, s.asOf, s.dataThrough, batch, {
          usageSnaps, usageNow: s.prep.usageNow ?? 0,
          contestFor: m => contestFor(counts!, m), latestWeekEnd: weekRanges(s.asOf, 1)[0].end,
        }, gaps, { daily: await dailyFor(e, from, to) })
      } catch (err) {
        const msg = String((err as Error)?.message ?? err).slice(0, 500)
        s.periods = s.periods.map(p => (ids.has(p.id) ? { ...p, status: 'error' as const, reason: msg } : p))
        throw new StepError(msg, s.current)
      }
      await d.store.savePeriods(pulled.periods)
      const at = iso(d.now())
      const byId = new Map(pulled.periods.map(p => [`${p.period_type}:${p.period_key}`, p]))
      s.periods = s.periods.map(p => {
        const got = byId.get(p.id)
        if (!got) return p
        const c = classify(got, pulled.diag[p.id], gaps)
        return { id: p.id, type: p.type, key: p.key, start: p.start, end: p.end, partial: p.partial, pulledAt: at, ...c }
      })
      pulledThisStep += batch.length
      await progress()
    }

    // ---- Build, audit and publish straight to the store
    if (s.phase === 'publish') {
      s.current = 'build and publish'
      const e = await client()
      const stored = await d.store.loadPeriods()
      const wanted = new Set(backfillWanted(s.asOf, s.dataThrough, s.yearStart).map(idOf))
      const use = stored.filter(p => wanted.has(`${p.period_type}:${p.period_key}`) && p.raw_version === RAW_VERSION)
      const counts = contestCounts(await d.store.loadContestMonths())
      const allTime: RangeRaw = {
        creatorsPosted: (await pullOverview(e, s.asOf, LAUNCH_DATE, s.dataThrough)).creatorsPosted,
        contestAffiliates: counts.allTime || null,
        usageRightsCreators: s.prep.usageNow,
      }
      const raw = assembleRaw({ asOf: s.asOf, yearStart: s.weeksFrom, dataThrough: s.dataThrough, periods: use, allTime, pulled: s.periods.filter(p => PULLED.includes(p.status)).length })
      const sc = buildScorecard(raw, await d.store.loadManual().catch(() => []))
      const audit = auditScorecard(sc)
      if (audit.status !== 'PASS') throw new StepError(`The scorecard failed its audit, so nothing was published: ${audit.failures.slice(0, 5).join('; ')}`, null, 'Run the backfill again with "Re-pull everything" ticked. If it fails the same way, the numbers need a developer to look at them; do not edit them by hand.')
      await d.store.publish(s.asOf, raw, sc, { status: audit.status, failures: audit.failures, warnings: audit.warnings.slice(0, 50) })
      s.summary = summarize(s, sc, use)
      s.phase = 'done'; s.status = 'done'; s.current = null; s.finishedAt = iso(d.now()); s.lastError = undefined
      const missing = [...s.summary.noData, ...s.summary.partial]
      if (missing.length) {
        await sendAlert(d, s, 'MISSING', `The scorecard backfill finished and published ${s.asOf}, but ${missing.length} period(s) have missing data: ${missing.slice(0, 12).map(m => `${m.label} (${m.reason})`).join(' | ')}${missing.length > 12 ? ` and ${missing.length - 12} more` : ''}. Next step: open the Manage tab, Scorecard backfill, to see the full list. Periods Euka cannot return stay "no data"; enter history by hand only where Seller Center has it.`)
      }
      await progress()
    }
    return { ok: true, state: s }
  } catch (err) {
    const se = err instanceof StepError ? err : new StepError(String((err as Error)?.message ?? err).slice(0, 500), s.current)
    s.status = 'failed'; s.finishedAt = iso(d.now())
    s.lastError = { at: iso(d.now()), period: se.period, message: se.message, nextStep: se.nextStep }
    await sendAlert(d, s, 'FAILED', `The scorecard backfill failed at ${describe(s, se.period)}: ${se.message}. ${done(s)} of ${s.periods.length} periods are finished and saved. Next step: ${se.nextStep}`)
    await d.store.writeState(s).catch(() => {})
    return { ok: true, state: s }
  } finally {
    await conn.e?.close?.().catch(() => {})
    // Release the lease. If this fails the lease simply expires.
    await d.store.casLock(JSON.stringify(lease), { ...lease, leaseUntil: 0 }).catch(() => false)
  }
}

class StepError extends Error {
  constructor(message: string, public period: string | null, public nextStep = 'Open the Manage tab, Scorecard backfill, and click Resume. If it fails again with an authorization error, refresh EUKA_BEARER_TOKEN in Vercel and redeploy.') { super(message) }
}

function summarize(s: BackfillState, sc: Scorecard, used: StoredPeriod[]): BackfillSummary {
  const list = (st: PeriodStatus) => s.periods.filter(p => p.status === st).map(p => ({ id: p.id, label: periodLabel(p), reason: p.reason ?? '' }))
  const todo = buildTodo(sc)
  const m = sc.monthly[0]
  const proofP = s.mode === 'proof' ? s.periods[0] : null
  const proofRaw = proofP ? used.find(u => `${u.period_type}:${u.period_key}` === proofP.id) : null
  const proofWeek = proofP ? (sc.weeklyAll ?? sc.weekly).find(w => w.key === proofP.key) : null
  return {
    weeksStored: used.filter(p => p.period_type === 'week').length, monthsStored: used.filter(p => p.period_type === 'month').length,
    reused: s.periods.filter(p => p.status === 'skipped').length,
    noData: list('no_data'), partial: list('partial'),
    controlDiffs: s.periods.flatMap(p => p.controlDiffs ?? []),
    cofundedTodo: { weeks: todo.cofunded.filter(c => c.period_type === 'week').length, months: todo.cofunded.filter(c => c.period_type === 'month').length, text: todo.summary },
    currentMonth: m?.partial ? { key: m.key, daysElapsed: m.daysElapsed, daysInMonth: m.daysInMonth, mtdGmv: m.lines.gmv.value, projectedGmv: m.projected?.gmv ?? null } : null,
    publishedAsOf: sc.asOf, auditWarnings: auditScorecard(sc).warnings.length,
    ...(proofP && proofRaw ? { proof: { label: periodLabel(proofP), start: proofP.start, end: proofP.end, raw: proofRaw.raw, gmvMaxRoi: proofWeek?.lines.gmvMaxRoi.value ?? null } } : {}),
  }
}
