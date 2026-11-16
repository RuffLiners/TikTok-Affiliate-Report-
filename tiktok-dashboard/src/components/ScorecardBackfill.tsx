'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BackfillState, PeriodProgress, PeriodStatus } from '@/lib/scorecard/engine'

interface Meta { alerts: { slack: boolean; email: boolean; missing: string[]; emailTo: string }; stallMinutes: number; defaultYearStart: string; now: string }
type Resp = Partial<Meta> & { ok?: boolean; state?: BackfillState | null; error?: string; reason?: string }

const STATUS: Record<PeriodStatus, { label: string; cls: string }> = {
  pending: { label: 'Waiting', cls: 'bg-gray-100 text-gray-500' },
  skipped: { label: 'Already stored', cls: 'bg-gray-100 text-gray-600' },
  stored: { label: 'Stored', cls: 'bg-green-50 text-green-700' },
  partial: { label: 'Partly no data', cls: 'bg-amber-50 text-amber-700' },
  no_data: { label: 'No data', cls: 'bg-amber-50 text-amber-700' },
  error: { label: 'Failed', cls: 'bg-red-50 text-red-700' },
}
const FIELD: Record<string, string> = {
  shopGmv: 'TikTok GMV', gmvMaxRevenue: 'TikTok Gross Revenue', gmvMaxSpend: 'GMV Max spend', targetInvites: 'Target Collab invites sent',
  eukaMessages: 'Euka messages sent', emails: 'Emails sent', samplesApproved: 'Free samples approved', creatorsPosted: 'Creators posted',
  videos: 'Affiliate videos posted', views: 'Views', contestAffiliates: 'Affiliates in monthly contest', usageRightsCreators: 'Affiliates with usage rights',
}
const MONEY = new Set(['shopGmv', 'gmvMaxRevenue', 'gmvMaxSpend'])
const fmtVal = (k: string, v: number | null | undefined) => (v == null ? 'no data' : MONEY.has(k) ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v.toLocaleString('en-US'))
const label = (p: PeriodProgress) => (p.type === 'week' ? `${p.start} to ${p.end}` : p.partial ? `${p.key} (month to date, through ${p.end})` : p.key)
const ago = (iso: string, now: number) => { const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000)); return m < 1 ? 'under a minute ago' : `${m} min ago` }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export function ScorecardBackfill() {
  const [state, setState] = useState<BackfillState | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [yearStart, setYearStart] = useState('2025-10-01')
  const [force, setForce] = useState(false)
  const [driving, setDriving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const drivingRef = useRef(false)

  const apply = useCallback((j: Resp) => {
    if (j.state !== undefined) setState(j.state ?? null)
    if (j.alerts) setMeta({ alerts: j.alerts, stallMinutes: j.stallMinutes ?? 10, defaultYearStart: j.defaultYearStart ?? '2025-10-01', now: j.now ?? '' })
    setNow(Date.now())
  }, [])
  const call = useCallback(async (body?: Record<string, unknown>): Promise<{ status: number; j: Resp }> => {
    const r = await fetch('/api/admin/scorecard-backfill', body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' })
    const j: Resp = await r.json().catch(() => ({ error: `The server returned ${r.status} with no details` }))
    apply(j)
    return { status: r.status, j }
  }, [apply])

  // Load on open, then refresh while a run is active elsewhere (this also lets the server raise a stall alert)
  useEffect(() => { call().catch(() => setMsg({ ok: false, text: 'Could not load the backfill status. Reload the page.' })).finally(() => setLoaded(true)) }, [call])
  useEffect(() => {
    const t = setInterval(() => { if (!drivingRef.current) call().catch(() => {}); else setNow(Date.now()) }, 20000)
    return () => clearInterval(t)
  }, [call])

  /** Keep asking the server for the next batch until the run stops. Safe to run in two tabs: the server allows one step at a time. */
  const drive = useCallback(async (runId: string) => {
    if (drivingRef.current) return
    drivingRef.current = true; setDriving(true)
    let netFails = 0
    try {
      for (;;) {
        let res: { status: number; j: Resp }
        try { res = await call({ action: 'step', run_id: runId }); netFails = 0 }
        catch {
          if (++netFails > 5) { setMsg({ ok: false, text: 'Lost contact with the server 6 times in a row. Progress so far is saved. Click Resume to continue.' }); return }
          await sleep(5000); continue
        }
        const { j } = res
        if (j.ok && j.state?.status === 'running') continue
        if (j.ok) return
        if (j.reason === 'busy') { await sleep(5000); continue }
        setMsg({ ok: false, text: j.error || 'The step failed. Progress so far is saved. Click Resume to continue.' })
        return
      }
    } finally { drivingRef.current = false; setDriving(false) }
  }, [call])

  async function begin(action: 'start' | 'proof' | 'resume') {
    setMsg(null)
    if (action === 'start' && force && !confirm('Re-pull every week and month from Euka, replacing what is stored? This takes longer.')) return
    try {
      const { j } = await call({ action, year_start: yearStart, force_refresh: action === 'start' ? force : false })
      if (!j.ok || !j.state) { setMsg({ ok: false, text: j.error || 'Could not start.' }); return }
      await drive(j.state.runId)
    } catch { setMsg({ ok: false, text: 'Could not reach the server. Nothing was started.' }) }
  }
  async function stop() {
    if (!confirm('Stop this backfill? Periods already stored are kept, and you can resume later.')) return
    await call({ action: 'cancel' }).catch(() => {})
  }

  const s = state
  const running = s?.status === 'running'
  const stalled = !!s && running && !driving && now - Date.parse(s.updatedAt) > (meta?.stallMinutes ?? 10) * 60000
  const canResume = !!s && !driving && (s.status === 'failed' || s.status === 'cancelled' || running)
  const weeks = s?.periods.filter(p => p.type === 'week') ?? [], months = s?.periods.filter(p => p.type === 'month') ?? []
  const finished = s ? s.periods.filter(p => p.status !== 'pending' && p.status !== 'error').length : 0
  const pct = s && s.periods.length ? Math.round((finished / s.periods.length) * 100) : 0
  const cur = s?.current ? s.periods.find(p => p.id === s.current) : null
  const curText = !s || !running ? '' : cur ? `${cur.type === 'week' ? 'Week' : 'Month'} ${label(cur)}` : s.current ? s.current : s.phase === 'prep' ? 'Preparing: contests and usage rights' : 'Next batch'
  const btn = 'text-sm font-medium px-4 py-2 rounded-xl disabled:opacity-40 transition-colors'

  const list = (title: string, rows: PeriodProgress[]) => (
    <div>
      <h4 className="text-xs font-semibold text-gray-700 mb-1">{title} ({rows.filter(p => p.status !== 'pending' && p.status !== 'error').length} of {rows.length} done)</h4>
      <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-xl">
        <table className="w-full text-xs">
          <tbody>{rows.map(p => (
            <tr key={p.id} className={`border-t border-gray-50 first:border-t-0 ${s?.current === p.id && running ? 'bg-blue-50' : ''}`}>
              <td className="py-1.5 px-3 tabular-nums whitespace-nowrap align-top text-gray-700">{label(p)}</td>
              <td className="py-1.5 px-2 align-top whitespace-nowrap"><span className={`px-2 py-0.5 rounded-full ${STATUS[p.status].cls}`}>{s?.current === p.id && running ? 'Pulling now' : STATUS[p.status].label}</span></td>
              <td className="py-1.5 px-3 align-top text-gray-500">{p.status === 'pending' || p.status === 'stored' || p.status === 'skipped' ? '' : p.reason}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  )

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Scorecard backfill</h3>
        <p className="text-xs text-gray-500 mt-1">Pulls every Sunday to Saturday week and every month from Euka, from the start date to today, and publishes the scorecard. Periods already stored and settled are skipped; the current month is always pulled again. Keep this tab open while it runs. If it stops, nothing is lost: click Resume.</p>
      </div>

      {meta && meta.alerts.missing.length > 0 && (
        <div role="alert" className="text-xs bg-red-50 border border-red-200 text-red-800 rounded-xl p-3">
          <strong>Alerts cannot be delivered yet.</strong> {!meta.alerts.slack && !meta.alerts.email ? 'Neither Slack nor email is set up' : !meta.alerts.slack ? 'Slack is not set up' : 'Email is not set up'}, so a failure will only show on this page. Add in Vercel, Settings, Environment Variables, then redeploy: <code>{meta.alerts.missing.join(', ')}</code>.
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">Start date
          <input type="date" min="2025-10-01" value={yearStart} onChange={e => setYearStart(e.target.value)} disabled={driving || running} className="block border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 disabled:opacity-50" /></label>
        <label className="text-xs text-gray-600 flex items-center gap-2 pb-2.5"><input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} disabled={driving || running} />Re-pull everything, even periods already stored</label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => begin('start')} disabled={!loaded || driving || (running && !stalled) || !yearStart} className={`${btn} bg-gray-900 text-white hover:bg-gray-800`}>Run backfill</button>
        <button onClick={() => begin('proof')} disabled={!loaded || driving || (running && !stalled)} className={`${btn} border border-gray-200 text-gray-700 hover:bg-gray-50`}>Test with the latest week only</button>
        {canResume && <button onClick={() => (running && !stalled ? drive(s!.runId) : begin('resume'))} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>Resume</button>}
        {running && <button onClick={stop} className={`${btn} border border-gray-200 text-red-600 hover:bg-red-50`}>Stop</button>}
      </div>
      {msg && <p role="alert" className={`text-xs ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>}
      {!loaded && <p className="text-xs text-gray-400">Loading status…</p>}
      {loaded && !s && <p className="text-xs text-gray-500">No backfill has been run yet.</p>}

      {s && (
        <div className="space-y-4" aria-live="polite">
          <div>
            <div className="flex flex-wrap justify-between gap-2 text-xs mb-1">
              <span className="font-medium text-gray-900">
                {s.status === 'done' ? 'Finished' : s.status === 'failed' ? 'Failed' : s.status === 'cancelled' ? 'Stopped' : stalled ? 'Stalled' : driving ? 'Running' : 'Running (not from this tab)'}
                {s.mode === 'proof' ? ' · latest-week test' : ''} · {finished} of {s.periods.length} periods done, {s.periods.length - finished} remaining
              </span>
              <span className="text-gray-500">Started {s.startedAt.slice(0, 16).replace('T', ' ')} UTC · last progress {ago(s.updatedAt, now)} · data through {s.dataThrough}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className={`h-full ${s.status === 'failed' ? 'bg-red-500' : s.status === 'done' ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
            </div>
            {running && <p className="text-xs text-gray-600 mt-1">{driving ? 'Working on' : 'Last working on'}: {curText}</p>}
            {running && !driving && !stalled && <p className="text-xs text-amber-700 mt-1">This run is not being driven from this tab. If another tab or admin has it open, leave it. If not, click Resume to continue it here.</p>}
            {stalled && <p role="alert" className="text-xs text-red-700 mt-1">No progress for over {meta?.stallMinutes ?? 10} minutes. Everything pulled so far is saved. Click Resume.</p>}
          </div>

          {s.lastError && s.status === 'failed' && (
            <div role="alert" className="text-xs bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 space-y-1">
              <p><strong>Failed{s.lastError.period ? ` at ${s.lastError.period.replace(':', ' ')}` : ''}.</strong> {s.lastError.message}</p>
              <p><strong>Next step:</strong> {s.lastError.nextStep}</p>
            </div>
          )}

          {s.alerts.length > 0 && (
            <div className="text-xs border border-gray-100 rounded-xl p-3 space-y-1">
              <h4 className="font-semibold text-gray-700">Alerts raised by this run</h4>
              {s.alerts.slice(-4).reverse().map((a, i) => (
                <p key={i} className="text-gray-600"><span className="tabular-nums">{a.at.slice(0, 16).replace('T', ' ')}</span> · {a.kind} · Slack: <span className={a.slack === 'sent' ? 'text-green-700' : 'text-red-700'}>{a.slack}</span> · Email: <span className={a.email === 'sent' ? 'text-green-700' : 'text-red-700'}>{a.email}</span></p>))}
            </div>
          )}

          {s.status === 'done' && s.summary && (
            <div className="text-xs bg-green-50 border border-green-200 rounded-xl p-4 space-y-2 text-gray-800">
              <h4 className="text-sm font-semibold text-green-900">Scorecard published for {s.summary.publishedAsOf}</h4>
              <p><strong>{s.summary.weeksStored}</strong> weeks and <strong>{s.summary.monthsStored}</strong> months are stored ({s.summary.reused} reused from earlier runs, the rest pulled now).</p>
              {s.summary.currentMonth && <p>{s.summary.currentMonth.key} is month to date ({s.summary.currentMonth.daysElapsed} of {s.summary.currentMonth.daysInMonth} days): GMV {fmtVal('shopGmv', s.summary.currentMonth.mtdGmv)}, straight-line month-end estimate {fmtVal('shopGmv', s.summary.currentMonth.projectedGmv)}.</p>}
              <p><strong>Periods with no data: {s.summary.noData.length}.</strong> {s.summary.noData.length === 0 ? 'Euka returned data for every period.' : ''}</p>
              {s.summary.noData.length > 0 && <ul className="list-disc pl-5 space-y-0.5 max-h-40 overflow-y-auto">{s.summary.noData.map(n => <li key={n.id}>{n.label}: {n.reason}</li>)}</ul>}
              {s.summary.partial.length > 0 && (<><p><strong>Periods missing some lines: {s.summary.partial.length}.</strong></p>
                <ul className="list-disc pl-5 space-y-0.5 max-h-40 overflow-y-auto">{s.summary.partial.map(n => <li key={n.id}>{n.label}: {n.reason}</li>)}</ul></>)}
              {s.summary.controlDiffs.length > 0 && (<><p><strong>Daily sums that differ from Euka&apos;s own range totals: {s.summary.controlDiffs.length}.</strong> Stored as pulled; worth a look.</p>
                <ul className="list-disc pl-5 space-y-0.5 max-h-32 overflow-y-auto">{s.summary.controlDiffs.map((c, i) => <li key={i}>{c}</li>)}</ul></>)}
              <p><strong>Still needs manual entry:</strong> GMV with TikTok co-funding for {s.summary.cofundedTodo.weeks} week(s) and {s.summary.cofundedTodo.months} month(s). Euka has no field for it. Enter it from Seller Center in the panel below, or import a CSV.</p>
              {s.summary.proof && (
                <div className="bg-white border border-green-200 rounded-lg p-3">
                  <p className="font-semibold mb-1">Check these against Euka: {s.summary.proof.label}</p>
                  <table className="w-full"><tbody>
                    {Object.keys(FIELD).map(k => <tr key={k} className="border-t border-gray-50 first:border-t-0"><td className="py-0.5 text-gray-600">{FIELD[k]}</td><td className="py-0.5 text-right tabular-nums">{fmtVal(k, (s.summary!.proof!.raw as Record<string, number | null | undefined>)[k])}</td></tr>)}
                    <tr className="border-t border-gray-50"><td className="py-0.5 text-gray-600">GMV Max ROI (Gross Revenue / spend)</td><td className="py-0.5 text-right tabular-nums">{s.summary.proof.gmvMaxRoi ?? 'no data'}</td></tr>
                  </tbody></table>
                </div>
              )}
            </div>
          )}

          {weeks.length > 0 && list('Weeks, newest first', weeks)}
          {months.length > 0 && list('Months, newest first', months)}
        </div>
      )}
    </div>
  )
}
