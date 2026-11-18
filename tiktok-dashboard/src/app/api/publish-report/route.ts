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
 *   ?periods=1                -> every stored week and month (the period store), so a run only pulls what is missing
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
  let periods: unknown = []
  if (req.nextUrl.searchParams.get('periods')) {
    const { data } = await supabase.from('scorecard_periods').select('period_type, period_key, start_date, end_date, raw, raw_version, final, pulled_at').limit(2000)
    periods = data ?? []
  }
  let contestMonths: unknown = []
  if (req.nextUrl.searchParams.get('contests')) {
    const { data } = await supabase.from('scorecard_contest_months').select('month, creator_ids, final').limit(200)
    contestMonths = data ?? []
  }
  return NextResponse.json({ latest: latest ?? null, snapshots, periods, contestMonths })
}

/**
 * Scheduled-run publish. Auth: Authorization: Bearer $REPORT_PUBLISH_TOKEN (Vercel env var, never in the repo).
 * Body: { meta:{reportDate}, audit:{status:'PASS',...}, scorecardRaw, scorecard, ...optional legacy report fields }.
 * Or { reportOnly: true, audit:{status:'PASS'}, meta, d30, weeklyCharts, monthlyCharts, tables, agents, analysis }: the weekly report alone.
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
  // Period store writes. Called only after the run's audits pass, so unaudited pulls never become permanent.
  if (report?.periodsOnly) {
    const list: any[] = Array.isArray(report.periods) ? report.periods : []
    const cm: any[] = Array.isArray(report.contestMonths) ? report.contestMonths : []
    const drift: any[] = Array.isArray(report.drift) ? report.drift : []
    const ok = list.filter(p => (p?.period_type === 'week' || p?.period_type === 'month') && /^\d{4}-\d{2}(-\d{2})?$/.test(String(p?.period_key))
      && /^\d{4}-\d{2}-\d{2}$/.test(String(p?.start_date)) && /^\d{4}-\d{2}-\d{2}$/.test(String(p?.end_date)) && p?.raw && typeof p.raw === 'object')
    if (ok.length !== list.length) return NextResponse.json({ error: `periods invalid: ${ok.length} of ${list.length} usable` }, { status: 400 })
    const cmOk = cm.filter(m => /^\d{4}-\d{2}$/.test(String(m?.month)) && Array.isArray(m?.creator_ids) && m.creator_ids.every((x: unknown) => typeof x === 'string'))
    if (cmOk.length !== cm.length) return NextResponse.json({ error: `contestMonths invalid: ${cmOk.length} of ${cm.length} usable` }, { status: 400 })
    if (!ok.length && !cm.length && !drift.length) return NextResponse.json({ error: 'nothing to save' }, { status: 400 })
    const rows = ok.map(p => ({ period_type: p.period_type, period_key: p.period_key, start_date: p.start_date, end_date: p.end_date, raw: p.raw, raw_version: Number(p.raw_version) || 1, final: !!p.final, pulled_at: new Date().toISOString() }))
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await supabaseAdmin().from('scorecard_periods').upsert(rows.slice(i, i + 100), { onConflict: 'period_type,period_key' })
      if (error) return NextResponse.json({ error: error.message, savedBeforeError: i }, { status: 500 })
    }
    if (cmOk.length) {
      const { error } = await supabaseAdmin().from('scorecard_contest_months').upsert(
        cmOk.map(m => ({ month: m.month, creator_ids: m.creator_ids, creator_count: new Set(m.creator_ids).size, final: !!m.final, pulled_at: new Date().toISOString() })), { onConflict: 'month' })
      if (error) return NextResponse.json({ error: 'contest months: ' + error.message }, { status: 500 })
    }
    if (drift.length) {
      const dRows = drift.slice(0, 500).map(d => ({ run_date: report.runDate ?? null, stage: String(d.stage ?? ''), period_type: String(d.period_type ?? ''), period_key: String(d.period_key ?? ''), field: String(d.field ?? ''), stored_value: typeof d.stored === 'number' ? d.stored : null, fresh_value: typeof d.fresh === 'number' ? d.fresh : null }))
      const { error } = await supabaseAdmin().from('scorecard_drift_log').insert(dRows)
      if (error) return NextResponse.json({ error: 'drift log: ' + error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, saved: rows.length, final: rows.filter(r => r.final).length, contestMonths: cmOk.length, drift: drift.length })
  }
  // Weekly report only (GitHub "Weekly report" workflow): no scorecard, never touches the scorecards table.
  // saveReportCore re-runs validateGeneratedReport, the review flags and reconciliation, so the sender is not trusted.
  if (report?.reportOnly === true) {
    if (report?.audit?.status !== 'PASS') {
      return NextResponse.json({ error: `Rejected: audit.status is "${report?.audit?.status ?? 'missing'}", must be PASS`, failures: report?.audit?.failures ?? [] }, { status: 422 })
    }
    const { reportOnly: _ro, audit: _audit, ...body } = report
    return saveReportCore(body, 'scheduled-publish')
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
