import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { reportDate } = await req.json().catch(() => ({}))
  if (!reportDate) return NextResponse.json({ error: 'Missing reportDate' }, { status: 400 })

  const supabase = supabaseAdmin()
  const { error } = await supabase
    .from('weekly_reports')
    .delete()
    .eq('report_date', reportDate)

  if (error) return NextResponse.json({ error: 'Delete failed: ' + error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
