import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

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

  const supabase = supabaseAdmin()

  const rowWithAnalysis = {
    report_date:    report.meta.reportDate,
    label:          report.meta.label,
    data_window:    report.meta.dataWindow,
    d30:            report.d30,
    weekly_charts:  report.weeklyCharts,
    monthly_charts: report.monthlyCharts,
    tables:         report.tables,
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

  return NextResponse.json({
    ok: true,
    reportDate: report.meta.reportDate,
    label:      report.meta.label,
    gmv:        report.d30.gmv
  })
}
