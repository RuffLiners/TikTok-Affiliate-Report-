import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const date = req.nextUrl.searchParams.get('date')
  if (!date) return NextResponse.json({ error: 'Missing date param' }, { status: 400 })

  const supabase = supabaseAdmin()
  const { data, error } = await supabase
    .from('weekly_reports')
    .select('*')
    .eq('report_date', date)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

  return NextResponse.json(data)
}
