import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

/** Vercel Cron sends "Authorization: Bearer $CRON_SECRET". Returns a response to send back when the call is not allowed. */
export function cronDenied(req: NextRequest): NextResponse | null {
  const expected = (process.env.CRON_SECRET || '').trim()
  if (!expected) return NextResponse.json({ error: 'CRON_SECRET is not set in Vercel; scheduled scorecard jobs are disabled' }, { status: 503 })
  const got = Buffer.from((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()), want = Buffer.from(expected)
  if (got.length !== want.length || !timingSafeEqual(got, want)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return null
}
