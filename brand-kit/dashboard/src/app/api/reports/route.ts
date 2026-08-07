import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('weekly_reports')
    .select('report_date, label, data_window, created_at, d30')
    .order('report_date', { ascending: false })

  if (error) return NextResponse.json({ error }, { status: 500 })

  const reports = data.map(r => ({
    report_date: r.report_date,
    label: r.label,
    data_window: r.data_window,
    created_at: r.created_at,
    d30_gmv: r.d30?.gmv ?? 0
  }))

  return NextResponse.json(reports)
}
