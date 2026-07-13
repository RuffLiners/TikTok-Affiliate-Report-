import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { reconcileD30 } from '@/lib/reconcile'
import { sanitizeRows, sanitizeTables } from '@/lib/sanitize'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
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

  report.tables = sanitizeTables(report.tables)
  if (report.d30.gmvMaxByAge) report.d30.gmvMaxByAge = sanitizeRows(report.d30.gmvMaxByAge)

  const supabase = supabaseAdmin()

  const reconWarnings = reconcileD30(report.d30)
  if (reconWarnings.length) report.d30.reconciliation = reconWarnings

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
  // report's window is the calendar month, not the trailing 30 days
  if (report.d30.reportType === 'monthly') {
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
