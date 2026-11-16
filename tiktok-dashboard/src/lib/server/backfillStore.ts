import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { loadManualEntries } from '@/lib/scorecardStore'
import type { BackfillState, BackfillStore, Deps, LockRec } from '@/lib/scorecard/engine'
import { connectEuka } from './eukaClient'
import { sendBackfillAlert } from './alerts'

const LOCK_KEY = 'scorecard_backfill_lock'
const STATE_KEY = 'scorecard_backfill_state'

/** Backfill storage on the existing tables. The lock and run state live in app_config, so no schema change is needed. */
export function supabaseBackfillStore(): BackfillStore {
  const sb = supabaseAdmin()
  const must = <T extends { error: { message: string } | null }>(r: T, what: string): T => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r }
  return {
    async readLock() {
      const { data } = must(await sb.from('app_config').select('value').eq('key', LOCK_KEY).maybeSingle(), 'read lock')
      if (!data?.value) return null
      try { return { raw: data.value as string, rec: JSON.parse(data.value as string) as LockRec } } catch { return { raw: data.value as string, rec: { runId: '', leaseUntil: 0, at: '' } } }
    },
    // Compare-and-swap. The insert relies on the unique key; the update only matches the exact text that was read.
    async casLock(expectedRaw, next) {
      const value = JSON.stringify(next)
      if (expectedRaw === null) {
        const { error } = await sb.from('app_config').insert({ key: LOCK_KEY, value })
        return !error
      }
      const { data, error } = await sb.from('app_config').update({ value, updated_at: new Date().toISOString() }).eq('key', LOCK_KEY).eq('value', expectedRaw).select('key')
      return !error && (data?.length ?? 0) === 1
    },
    async readState() {
      const { data } = must(await sb.from('app_config').select('value').eq('key', STATE_KEY).maybeSingle(), 'read backfill state')
      if (!data?.value) return null
      try { return JSON.parse(data.value as string) as BackfillState } catch { return null }
    },
    async writeState(s) {
      must(await sb.from('app_config').upsert({ key: STATE_KEY, value: JSON.stringify(s), updated_at: new Date().toISOString() }, { onConflict: 'key' }), 'save backfill state')
    },
    async loadPeriods() {
      const { data } = must(await sb.from('scorecard_periods').select('period_type, period_key, start_date, end_date, raw, raw_version, final').limit(2000), 'load periods')
      return (data ?? []) as any
    },
    async savePeriods(periods) {
      const rows = periods.map(p => ({ period_type: p.period_type, period_key: p.period_key, start_date: p.start_date, end_date: p.end_date, raw: p.raw, raw_version: p.raw_version, final: p.final, pulled_at: new Date().toISOString() }))
      if (rows.length) must(await sb.from('scorecard_periods').upsert(rows, { onConflict: 'period_type,period_key' }), 'save periods')
    },
    async loadContestMonths() {
      const { data } = must(await sb.from('scorecard_contest_months').select('month, creator_ids, final').limit(200), 'load contest months')
      return (data ?? []) as any
    },
    async saveContestMonths(months) {
      if (!months.length) return
      must(await sb.from('scorecard_contest_months').upsert(months.map(m => ({ month: m.month, creator_ids: m.creator_ids, creator_count: new Set(m.creator_ids).size, final: m.final, pulled_at: new Date().toISOString() })), { onConflict: 'month' }), 'save contest months')
    },
    async loadSnapshots(key) {
      const { data } = must(await sb.from('scorecard_snapshots').select('snap_date, value').eq('key', key).order('snap_date', { ascending: false }).limit(800), 'load snapshots')
      return (data ?? []).map(r => ({ snap_date: r.snap_date as string, value: Number(r.value) }))
    },
    loadManual: () => loadManualEntries(),
    async publish(asOf, raw, scorecard, audit) {
      must(await sb.from('scorecards').upsert({ as_of: asOf, raw, scorecard, audit: { ...audit, checks: ['typescript-rules', 'range-total-cross-check'] }, published_by: 'dashboard-backfill' }, { onConflict: 'as_of' }), 'publish scorecard')
      try { revalidatePath('/dashboard') } catch { /* outside a request (tests, scripts) */ }
    },
  }
}

export const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

export function backfillDeps(): Deps {
  return { store: supabaseBackfillStore(), euka: connectEuka, notify: sendBackfillAlert, now: () => Date.now(), today: laToday }
}
