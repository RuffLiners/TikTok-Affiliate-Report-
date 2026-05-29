import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const segments = req.nextUrl.pathname.split('/')
  const id = segments[segments.length - 1]
  if (!id) return NextResponse.json({ error: 'Missing job id' }, { status: 400 })

  const supabase = supabaseAdmin()
  const { data, error } = await supabase
    .from('report_jobs')
    .select('id, status, phase, phase_label, error, updated_at, params')
    .eq('id', id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  return NextResponse.json(data)
}
