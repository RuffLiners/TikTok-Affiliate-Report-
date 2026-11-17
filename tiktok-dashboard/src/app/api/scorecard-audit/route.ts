import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { verifyToken } from '@/lib/auth'
import { buildScorecardAudit } from '@/lib/server/scorecardAudit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** A signed-in admin, or a machine holding CRON_SECRET or REPORT_PUBLISH_TOKEN (so Claude can fetch it without a browser). */
async function allowed(req: NextRequest): Promise<boolean> {
  const c = req.cookies.get('rl-auth')?.value
  if (c && (await verifyToken(c))) return true
  const got = Buffer.from((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim())
  if (!got.length) return false
  return [process.env.CRON_SECRET, process.env.REPORT_PUBLISH_TOKEN].some(t => { const w = Buffer.from((t || '').trim()); return w.length > 0 && w.length === got.length && timingSafeEqual(w, got) })
}

// Read only. One JSON file with everything the scorecard tool stored and published, the source of every line, and
// the tool's own integrity checks, written so Claude can audit it against Euka. Add ?download=1 to save it as a file.
export async function GET(req: NextRequest) {
  if (!(await allowed(req))) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    const body = await buildScorecardAudit()
    const headers: Record<string, string> = { 'cache-control': 'no-store' }
    if (req.nextUrl.searchParams.get('download')) headers['content-disposition'] = `attachment; filename="scorecard-audit-${body.published?.asOf ?? 'none'}.json"`
    return NextResponse.json(body, { headers })
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message).slice(0, 300) }, { status: 500 })
  }
}
