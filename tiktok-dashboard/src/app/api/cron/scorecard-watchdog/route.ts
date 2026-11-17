import { NextRequest, NextResponse } from 'next/server'
import { addDays } from '@/lib/scorecard'
import { checkStall, resumeRun, runCounts, runStep } from '@/lib/scorecard/engine'
import { supabaseAdmin } from '@/lib/supabase'
import { backfillDeps, laToday } from '@/lib/server/backfillStore'
import { sendBackfillAlert } from '@/lib/server/alerts'
import { cronDenied } from '@/lib/server/cronAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
const OVERDUE_DAYS = 8
const OVERDUE_KEY = 'scorecard_overdue_alerted'

// Vercel Cron, every 5 minutes. Three jobs:
//  1. continue a Monday cron run that did not finish in one call
//  2. alert once when a running backfill has made no progress for 10 minutes
//  3. alert once a day when the newest published scorecard is more than 8 days old (the Monday run never ran)
export async function GET(req: NextRequest) {
  const denied = cronDenied(req); if (denied) return denied
  try {
    const d = backfillDeps()
    let s = await d.store.readState()
    let continued = false
    // A cron run has no browser driving it: carry it on here, and pick it back up if it stalled
    if (s && s.trigger === 'cron' && s.status === 'stalled') { const r0 = await resumeRun(d); if (r0.ok) s = r0.state }
    if (s && s.status === 'running' && s.trigger === 'cron') {
      const r = await runStep(d, { runId: s.runId, budgetMs: 200_000 })
      continued = r.ok
      if (r.state) s = r.state
    }
    s = await checkStall(d)

    let overdue: string | null = null
    const sb = supabaseAdmin(), today = laToday()
    const { data: latest } = await sb.from('scorecards').select('as_of').order('as_of', { ascending: false }).limit(1).maybeSingle()
    if (latest?.as_of && String(latest.as_of) < addDays(today, -OVERDUE_DAYS) && s?.status !== 'running') {
      const { data: mark } = await sb.from('app_config').select('value').eq('key', OVERDUE_KEY).maybeSingle()
      if (mark?.value !== today) {
        await sb.from('app_config').upsert({ key: OVERDUE_KEY, value: today, updated_at: new Date().toISOString() }, { onConflict: 'key' })
        await sendBackfillAlert('OVERDUE', `The newest published scorecard is for ${latest.as_of}, more than ${OVERDUE_DAYS} days before today (${today}). The Monday run did not publish. Next step: open the dashboard, Manage tab, Scorecard backfill, and click Run backfill.`)
      }
      overdue = String(latest.as_of)
    }
    return NextResponse.json({ ok: true, status: s?.status ?? 'none', counts: s ? runCounts(s) : null, lastProgress: s?.updatedAt ?? null, stallAlerted: s?.stallAlerted ?? false, continuedCronRun: continued, overdueSince: overdue })
  } catch (e) {
    console.error('[scorecard-watchdog]', (e as Error).message)
    return NextResponse.json({ ok: false, error: String((e as Error).message).slice(0, 300) }, { status: 500 })
  }
}
