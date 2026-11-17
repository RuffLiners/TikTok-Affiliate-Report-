import { NextRequest, NextResponse } from 'next/server'
import { pullUsageRightsNow } from '@/lib/scorecard/engine'
import { supabaseAdmin } from '@/lib/supabase'
import { connectEuka } from '@/lib/server/eukaClient'
import { laToday } from '@/lib/server/backfillStore'
import { sendBackfillAlert } from '@/lib/server/alerts'
import { cronDenied } from '@/lib/server/cronAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Daily: record how many creators have active usage rights. Euka has no dated source for this, so history only
// exists from the first snapshot onward (replaces the GitHub "Scorecard daily snapshot" job).
export async function GET(req: NextRequest) {
  const denied = cronDenied(req); if (denied) return denied
  const day = laToday()
  try {
    const e = await connectEuka()
    let n: number
    try { n = await pullUsageRightsNow(e, `snapshot-${day}`) } finally { await e.close().catch(() => {}) }
    const { error } = await supabaseAdmin().from('scorecard_snapshots').upsert([{ snap_date: day, key: 'usageRightsCreators', value: n }], { onConflict: 'snap_date,key' })
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, day, usageRightsCreators: n })
  } catch (e) {
    const msg = String((e as Error).message).slice(0, 400)
    await sendBackfillAlert('FAILED', `The daily usage-rights snapshot for ${day} failed: ${msg}. The scorecard line "Affiliates with Usage Rights Authorized" will have a gap for this day. Next step: nothing if it works tomorrow; if it fails twice, check EUKA_BEARER_TOKEN in Vercel.`)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
