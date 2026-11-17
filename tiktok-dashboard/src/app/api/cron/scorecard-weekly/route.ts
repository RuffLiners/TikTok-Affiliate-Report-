import { NextRequest, NextResponse } from 'next/server'
import { runCounts, runStep, startRun, BackfillState } from '@/lib/scorecard/engine'
import { backfillDeps, laToday } from '@/lib/server/backfillStore'
import { sendBackfillAlert, sendSlack } from '@/lib/server/alerts'
import { cronDenied } from '@/lib/server/cronAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
const BUDGET_MS = 200_000

const money = (n: number | null | undefined) => (n == null ? 'no data' : '$' + Math.round(n).toLocaleString('en-US'))
function successText(s: BackfillState): string {
  const sum = s.summary!
  const pulled = s.periods.filter(p => p.status !== 'skipped').length
  const m = sum.currentMonth
  return [
    `:white_check_mark: *Weekly scorecard published for ${sum.publishedAsOf}*`,
    `Pulled ${pulled} period(s) from Euka, reused ${sum.reused} stored. Data through ${s.dataThrough}.`,
    m ? `${m.key} month to date (${m.daysElapsed}/${m.daysInMonth} days): GMV ${money(m.mtdGmv)}, straight-line month-end estimate ${money(m.projectedGmv)}.` : '',
    sum.noData.length + sum.partial.length ? `${sum.noData.length + sum.partial.length} period(s) pulled this run have missing data (details in the Manage tab).` : 'No missing data in the periods pulled this run.',
    `Still to enter from Seller Center: ${sum.cofundedTodo.text}`,
  ].filter(Boolean).join('\n')
}

// Monday scorecard run on Vercel Cron (replaces the GitHub "Weekly scorecard" workflow). Pulls the latest complete week,
// the month to date, and last month once it is 3 days past its end; fills anything missing; then publishes. Scheduled twice: the second call does nothing if the first one published, and retries if it did not.
export async function GET(req: NextRequest) {
  const denied = cronDenied(req); if (denied) return denied
  const t0 = Date.now()
  try {
    const d = backfillDeps()
    const today = laToday()
    const prev = await d.store.readState()
    if (req.nextUrl.searchParams.get('scope') !== 'full' && prev && prev.status === 'done' && prev.mode === 'full' && prev.asOf === today) return NextResponse.json({ ok: true, skipped: `already published for ${today}` })
    // ?scope=full runs the whole history (everything missing, unsettled or outdated). The watchdog finishes it if one call is not enough.
    const full = req.nextUrl.searchParams.get('scope') === 'full'
    const st = await startRun(d, { trigger: 'cron', scope: full ? 'full' : 'weekly', forceRefresh: req.nextUrl.searchParams.get('force') === '1' })
    if (!st.ok) return NextResponse.json({ ok: false, skipped: st.message }, { status: 409 })   // an admin's run is in progress; the retry or the overdue check covers it
    let s = st.state
    while (s.status === 'running' && Date.now() - t0 < BUDGET_MS) {
      const r = await runStep(d, { runId: s.runId, budgetMs: Math.max(20_000, BUDGET_MS - (Date.now() - t0)) })
      if (!r.ok) return NextResponse.json({ ok: false, error: r.message }, { status: 409 })
      s = r.state
    }
    // Not finished inside one call: the 5 minute watchdog continues cron runs. A failure has already alerted.
    const slack = s.status === 'done' ? await sendSlack(successText(s)) : 'n/a'
    return NextResponse.json({ ok: s.status !== 'failed', status: s.status, runId: s.runId, counts: runCounts(s), seconds: Math.round((Date.now() - t0) / 1000), slack, error: s.lastError?.message ?? null }, { status: s.status === 'failed' ? 500 : 200 })
  } catch (e) {
    const msg = String((e as Error).message).slice(0, 400)
    await sendBackfillAlert('FAILED', `The Monday scorecard run could not start: ${msg}. Nothing was published. Next step: open the dashboard, Manage tab, Scorecard backfill, and click Run backfill.`)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
