import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { auditScorecard, buildScorecard, Scorecard, ScorecardRaw } from '@/lib/scorecard'
import { saveReportCore } from '@/lib/saveReport'
import { loadManualEntries } from '@/lib/scorecardStore'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function tokenOk(req: NextRequest): 'ok' | 'unconfigured' | 'bad' {
  const expected = (process.env.REPORT_PUBLISH_TOKEN || '').trim()
  if (!expected) return 'unconfigured'
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '')
  if (!m) return 'bad'
  const a = Buffer.from(m[1].trim()), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'bad'
}

/**
 * GET (token): what the scheduled jobs need to read back without holding the Supabase service key.
 *   ?key=usageRightsCreators  -> daily snapshots of that counter
 *   (always) latest           -> as_of and created_at of the newest published scorecard, for the watchdog
 */
export async function GET(req: NextRequest) {
  const auth = tokenOk(req)
  if (auth === 'unconfigured') return NextResponse.json({ error: 'REPORT_PUBLISH_TOKEN is not set on the server' }, { status: 503 })
  if (auth === 'bad') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = supabaseAdmin()
  const { data: latest } = await supabase.from('scorecards').select('as_of, created_at').order('as_of', { ascending: false }).limit(1).maybeSingle()
  const key = req.nextUrl.searchParams.get('key')
  let snapshots: unknown = []
  if (key) {
    const { data } = await supabase.from('scorecard_snapshots').select('snap_date, value').eq('key', key).order('snap_date', { ascending: false }).limit(800)
    snapshots = (data ?? []).map(r => ({ snap_date: r.snap_date, value: Number(r.value) }))
  }
  return NextResponse.json({ latest: latest ?? null, snapshots })
}

/**
 * Scheduled-run publish. Auth: Authorization: Bearer $REPORT_PUBLISH_TOKEN (Vercel env var, never in the repo).
 * Body: { meta:{reportDate}, audit:{status:'PASS',...}, scorecardRaw, scorecard, ...optional legacy report fields }.
 * A report whose audit block is not PASS is rejected, and the scorecard is re-audited here regardless of what the sender claims.
 */
export async function POST(req: NextRequest) {
  const auth = tokenOk(req)
  if (auth === 'unconfigured') return NextResponse.json({ error: 'REPORT_PUBLISH_TOKEN is not set on the server; publishing is disabled' }, { status: 503 })
  if (auth === 'bad') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const report = await req.json().catch(() => null)
  if (!report) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  // Daily counter snapshots (no audit gate: they are inputs, not a published report)
  if (report?.snapshotOnly) {
    const snap = report.snapshot
    if (!snap?.date || !/^\d{4}-\d{2}-\d{2}$/.test(snap.date) || typeof snap.values !== 'object') {
      return NextResponse.json({ error: 'snapshot.date and snapshot.values are required' }, { status: 400 })
    }
    const rows = Object.entries(snap.values as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && (v as number) >= 0)
      .map(([key, value]) => ({ snap_date: snap.date, key, value }))
    if (!rows.length) return NextResponse.json({ error: 'no valid snapshot values' }, { status: 400 })
    const { error } = await supabaseAdmin().from('scorecard_snapshots').upsert(rows, { onConflict: 'snap_date,key' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, saved: rows.length })
  }
  if (report?.audit?.status !== 'PASS') {
    return NextResponse.json({ error: `Rejected: audit.status is "${report?.audit?.status ?? 'missing'}", must be PASS`, failures: report?.audit?.failures ?? [] }, { status: 422 })
  }
  const asOf: string | undefined = report?.meta?.reportDate
  const raw: ScorecardRaw | undefined = report?.scorecardRaw
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return NextResponse.json({ error: 'meta.reportDate (YYYY-MM-DD) is required' }, { status: 400 })
  if (!raw || raw.asOf !== asOf) return NextResponse.json({ error: 'scorecardRaw is required and its asOf must equal meta.reportDate' }, { status: 400 })

  // Rebuild from the raw pulls plus the manual Seller Center entries on file, and re-audit.
  // The server never trusts the sender's own audit or numbers.
  const manual = await loadManualEntries().catch(() => [])
  const rebuilt: Scorecard = buildScorecard(raw, manual)
  const audit = auditScorecard(rebuilt)
  if (audit.status !== 'PASS') return NextResponse.json({ error: 'Rejected: scorecard failed the server-side audit', failures: audit.failures }, { status: 422 })

  const supabase = supabaseAdmin()
  const { error } = await supabase.from('scorecards').upsert({
    as_of: asOf, raw, scorecard: rebuilt,
    audit: { status: audit.status, failures: audit.failures, warnings: audit.warnings, sender: report.audit },
    published_by: 'token',
  }, { onConflict: 'as_of' })
  if (error) return NextResponse.json({ error: 'Database save failed: ' + error.message }, { status: 500 })

  // Optional legacy sections go through the identical gate the pasted-report route uses
  let legacy: unknown = 'not included'
  if (report.d30 && report.weeklyCharts && report.monthlyCharts && report.tables) {
    const res = await saveReportCore(report, 'scheduled-publish')
    legacy = { status: res.status, body: await res.json().catch(() => null) }
  }
  revalidatePath('/dashboard')
  return NextResponse.json({ ok: true, asOf, issues: rebuilt.issues, legacy })
}
