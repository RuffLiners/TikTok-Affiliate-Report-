import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { reconcileD30 } from '@/lib/reconcile'
import { sanitizeRows, sanitizeTables } from '@/lib/sanitize'
import { validateGeneratedReport } from '@/lib/validateReport'
import { collectReviewFlags, splitReviewed, tierDefinitionNote } from '@/lib/sanityDiff'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('dash-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let report: any
  try {
    report = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON — could not parse' }, { status: 400 })
  }

  if (!report?.meta?.reportDate) {
    return NextResponse.json({ error: 'Missing meta.reportDate' }, { status: 400 })
  }
  if (!report?.d30?.gmv && report?.d30?.gmv !== 0) {
    return NextResponse.json({ error: 'Missing d30.gmv' }, { status: 400 })
  }
  if (!report?.weeklyCharts || !report?.monthlyCharts || !report?.tables) {
    return NextResponse.json({ error: 'Missing weeklyCharts, monthlyCharts, or tables' }, { status: 400 })
  }

  if (!report.analysis) report.analysis = { d30: '', weekly: '', monthly: '' }

  // Provenance: carry the pasted prompt's spec version (v3 manual prompt and
  // the regenerated skills stamp meta.promptVersion) into the stored report so
  // every report — manual or auto — records which spec produced it
  report.d30.meta = {
    ...(report.d30.meta || {}),
    ...(report.meta.promptVersion ? { promptVersion: report.meta.promptVersion } : {}),
    ...(report.meta.weekWindow ? { weekWindow: report.meta.weekWindow } : {}),
    source: 'manual-paste',
    savedAt: new Date().toISOString()
  }

  report.tables = sanitizeTables(report.tables)
  if (report.d30.gmvMaxByAge) report.d30.gmvMaxByAge = sanitizeRows(report.d30.gmvMaxByAge)

  const supabase = supabaseAdmin()

  // Same hard gate as the auto-generate pipeline (auto/manual parity): a
  // pasted report with an empty required table, blank-handle rows, or tier
  // sums that don't reconcile is rejected, never saved.
  const validationIssues = validateGeneratedReport({
    d30: report.d30,
    weekly_charts: report.weeklyCharts,
    monthly_charts: report.monthlyCharts,
    tables: report.tables
  })
  if (validationIssues.length) {
    return NextResponse.json({
      error: 'Report failed validation — nothing was saved. ' + validationIssues.join('; ')
    }, { status: 422 })
  }

  // Same sanity/review flags as the auto path: prior-report swings, tier-sum
  // $1 decomposition, suspiciously round monetary values — minus any flag a
  // human already marked reviewed/expected
  let priorD30: any = null
  try {
    const isMonthly = report.d30.reportType === 'monthly'
    const { data: priors } = await supabase.from('weekly_reports')
      .select('report_date, d30')
      .lt('report_date', report.meta.reportDate)
      .order('report_date', { ascending: false })
      .limit(10)
    priorD30 = (priors ?? []).find((r: any) => isMonthly === /-M$/.test(r.report_date))?.d30 ?? null
  } catch { /* first report ever — sanity diff runs without a prior */ }
  let reviewedKeys: string[] = []
  try {
    const { data: rk } = await supabase.from('app_config').select('value').eq('key', 'reviewed_flags').single()
    if (rk?.value) reviewedKeys = JSON.parse(rk.value)
  } catch { /* no reviewed flags stored yet */ }
  const allFlags = collectReviewFlags(
    { d30: report.d30, weekly_charts: report.weeklyCharts, tables: report.tables },
    priorD30
  )
  const { active: reviewFlags, reviewed } = splitReviewed(allFlags, reviewedKeys)
  if (reviewFlags.length) report.d30.needsReview = reviewFlags.map((f: any) => f.text)
  if (reviewFlags.length || reviewed.length) report.d30.reviewFlagKeys = allFlags.map((f: any) => ({ key: f.key, reviewed: reviewedKeys.includes(f.key) }))

  const reconWarnings = reconcileD30(report.d30)
  const tierNote = tierDefinitionNote(report.d30)
  const banner = [
    ...reviewFlags.map((f: any) => `NEEDS REVIEW: ${f.text}`),
    ...reviewed.map((f: any) => `Reviewed/expected: ${f.text}`),
    ...reconWarnings,
    ...(tierNote ? [tierNote] : [])
  ]
  if (banner.length) report.d30.reconciliation = banner

  // Snapshot the goals in effect this month into the report so past reports
  // keep showing the targets (and results) of their own month
  if (!report.d30.goals) {
    try {
      const { data: g } = await supabase.from('app_config').select('value').eq('key', 'goals').single()
      if (g?.value) report.d30.goals = JSON.parse(g.value)
    } catch { /* report saves without goals snapshot */ }
  }

  const rowWithAnalysis = {
    report_date:    report.meta.reportDate,
    label:          report.meta.label,
    data_window:    report.meta.dataWindow,
    d30:            report.d30,
    weekly_charts:  report.weeklyCharts,
    monthly_charts: report.monthlyCharts,
    tables:         report.tables,
    agents:         report.agents || [],
    analysis:       report.analysis
  }

  let { error: dbErr } = await supabase
    .from('weekly_reports')
    .upsert(rowWithAnalysis, { onConflict: 'report_date' })

  // If analysis column doesn't exist yet, retry without it
  if (dbErr?.message?.toLowerCase().includes('analysis')) {
    const { analysis: _omit, ...rowWithout } = rowWithAnalysis
    const retry = await supabase
      .from('weekly_reports')
      .upsert(rowWithout, { onConflict: 'report_date' })
    dbErr = retry.error
  }

  if (dbErr) {
    console.error('Supabase save error:', dbErr)
    return NextResponse.json({ error: 'Database save failed: ' + dbErr.message }, { status: 500 })
  }

  // Keep the Live 30 Day page in sync with weekly reports — a monthly
  // report's window is the calendar month, not the trailing 30 days.
  // A needs-review report never overwrites the live snapshot (parity with
  // the auto path): the saved report page shows the flags, the live page
  // keeps the last good data until a human confirms.
  if (report.d30.reportType === 'monthly' || reviewFlags.length) {
    revalidatePath('/dashboard')
    return NextResponse.json({
      ok: true,
      reportDate: report.meta.reportDate,
      label:      report.meta.label,
      gmv:        report.d30.gmv
    })
  }
  const liveData = {
    report_date: report.meta.reportDate,
    label:       report.meta.label,
    data_window: report.meta.dataWindow,
    d30:         report.d30,
    tables:      report.tables,
    agents:      report.agents || [],
    analysis:    { d30: report.analysis?.d30 || report.analysis?.performance || '' }
  }
  const { error: liveErr } = await supabase
    .from('app_config')
    .upsert({ key: 'live_report', value: JSON.stringify(liveData) }, { onConflict: 'key' })
  if (liveErr) console.error('Live snapshot update failed (report still saved):', liveErr)

  revalidatePath('/dashboard')
  return NextResponse.json({
    ok: true,
    reportDate: report.meta.reportDate,
    label:      report.meta.label,
    gmv:        report.d30.gmv
  })
}
