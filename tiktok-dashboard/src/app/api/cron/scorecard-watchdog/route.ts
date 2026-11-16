import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { checkStall } from '@/lib/scorecard/engine'
import { backfillDeps } from '@/lib/server/backfillStore'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Vercel Cron calls this every 5 minutes with "Authorization: Bearer $CRON_SECRET". It alerts once when a running
// backfill has made no progress for 10 minutes, even if nobody has the panel open.
export async function GET(req: NextRequest) {
  const expected = (process.env.CRON_SECRET || '').trim()
  if (!expected) return NextResponse.json({ error: 'CRON_SECRET is not set in Vercel; the stall watchdog is disabled' }, { status: 503 })
  const got = Buffer.from((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()), want = Buffer.from(expected)
  if (got.length !== want.length || !timingSafeEqual(got, want)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const s = await checkStall(backfillDeps())
    return NextResponse.json({ ok: true, status: s?.status ?? 'none', lastProgress: s?.updatedAt ?? null, stallAlerted: s?.stallAlerted ?? false })
  } catch (e) {
    console.error('[scorecard-watchdog]', (e as Error).message)
    return NextResponse.json({ ok: false, error: String((e as Error).message).slice(0, 300) }, { status: 500 })
  }
}
