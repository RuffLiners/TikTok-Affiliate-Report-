import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { verifyToken } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { buildWindows, todayInReportTz } from '@/lib/assembleReport'
import { connectEuka, redactSecrets } from '@/lib/server/eukaClient'
import { collectReportGroup1 } from '@/lib/server/reportData'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Read only. Pulls the weekly report's numbers straight from Euka (no model) for ?today=YYYY-MM-DD and returns them
// beside the saved report for that date, so the two can be compared before the live report is switched over.
export async function GET(req: NextRequest) {
  const cookie = req.cookies.get('rl-auth')?.value
  const bearer = Buffer.from((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim())
  const secret = Buffer.from((process.env.CRON_SECRET || '').trim())
  const machine = secret.length > 0 && bearer.length === secret.length && timingSafeEqual(bearer, secret)
  if (!machine && !(cookie && (await verifyToken(cookie)))) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const today = req.nextUrl.searchParams.get('today') || undefined
  if (today && !/^\d{4}-\d{2}-\d{2}$/.test(today)) return NextResponse.json({ error: 'today must be YYYY-MM-DD' }, { status: 400 })
  try {
    const w = buildWindows(todayInReportTz(today))
    const euka = await connectEuka()
    let direct
    try { direct = await collectReportGroup1(euka, w) } finally { await euka.close().catch(() => {}) }
    const { data: saved } = await supabaseAdmin().from('weekly_reports').select('report_date, created_at, d30, weekly_charts, monthly_charts').eq('report_date', w.reportDate).maybeSingle()
    return NextResponse.json({ reportDate: w.reportDate, direct, saved: saved ?? null }, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: redactSecrets(String((e as Error).message)).slice(0, 500) }, { status: 502 })
  }
}
