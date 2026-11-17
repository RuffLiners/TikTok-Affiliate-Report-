import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { cancelRun, checkStall, resumeRun, runStep, startRun, DEFAULT_YEAR_START, STALL_MS } from '@/lib/scorecard/engine'
import { backfillDeps } from '@/lib/server/backfillStore'
import { alertConfig, ALERT_EMAIL_TO } from '@/lib/server/alerts'
import { redactSecrets } from '@/lib/server/eukaClient'

export const dynamic = 'force-dynamic'
// One step stops starting new work after 150 seconds, so it finishes well inside this limit.
export const maxDuration = 300

async function admin(req: NextRequest): Promise<boolean> {
  const c = req.cookies.get('rl-auth')?.value
  return !!c && (await verifyToken(c))
}
const meta = () => ({ cronReady: !!(process.env.CRON_SECRET || '').trim(), alerts: { ...alertConfig(), emailTo: ALERT_EMAIL_TO }, stallMinutes: STALL_MS / 60000, defaultYearStart: DEFAULT_YEAR_START, now: new Date().toISOString() })
const fail = (e: unknown, status = 500) => NextResponse.json({ ok: false, error: redactSecrets(String((e as Error)?.message ?? e)).slice(0, 600), ...meta() }, { status })

// Admin only. Current run, its progress, and whether alerts can be delivered. Also raises the stall alert if one is due.
export async function GET(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    const state = await checkStall(backfillDeps())
    return NextResponse.json({ ok: true, state, ...meta() }, { headers: { 'cache-control': 'no-store' } })
  } catch (e) { return fail(e) }
}

/**
 * Admin only. Body: { action, year_start?, force_refresh?, run_id?, max_periods? }
 *   start   begin a run (year_start default 2025-10-01, force_refresh default false). 409 if one is already running.
 *   proof   begin a run limited to the most recent complete week, then publish. Proves the path end to end.
 *   step    process one bounded batch of the run `run_id` and return progress. Call repeatedly until status is done.
 *   resume  continue a run that failed, was cancelled, or stalled.
 *   cancel  stop the current run. Stored periods are kept.
 */
export async function POST(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const action = String(body?.action ?? '')
  try {
    const d = backfillDeps()
    if (action === 'start' || action === 'proof') {
      const ys = String(body?.year_start ?? DEFAULT_YEAR_START)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ys) || Number.isNaN(Date.parse(ys)) || ys < '2025-10-01' || ys > new Date().toISOString().slice(0, 10)) {
        return NextResponse.json({ ok: false, error: 'year_start must be a date (YYYY-MM-DD) from 2025-10-01 to today', ...meta() }, { status: 400 })
      }
      const r = await startRun(d, { yearStart: ys, forceRefresh: body?.force_refresh === true, mode: action === 'proof' ? 'proof' : 'full' })
      return NextResponse.json(r.ok ? { ok: true, state: r.state, ...meta() } : { ok: false, error: r.message, state: r.state, ...meta() }, { status: r.ok ? 200 : 409 })
    }
    if (action === 'resume') {
      const r = await resumeRun(d)
      return NextResponse.json(r.ok ? { ok: true, state: r.state, ...meta() } : { ok: false, error: r.message, state: r.state, ...meta() }, { status: r.ok ? 200 : 409 })
    }
    if (action === 'cancel') return NextResponse.json({ ok: true, state: await cancelRun(d), ...meta() })
    if (action === 'step') {
      const runId = String(body?.run_id ?? '')
      const max = Number(body?.max_periods)
      const r = await runStep(d, { runId, ...(Number.isInteger(max) && max > 0 ? { maxPeriods: max } : {}) })
      return NextResponse.json(r.ok ? { ok: true, state: r.state, ...meta() } : { ok: false, error: r.message, reason: r.reason, state: r.state, ...meta() }, { status: r.ok ? 200 : 409 })
    }
    return NextResponse.json({ ok: false, error: 'action must be start, proof, step, resume or cancel', ...meta() }, { status: 400 })
  } catch (e) { return fail(e) }
}
