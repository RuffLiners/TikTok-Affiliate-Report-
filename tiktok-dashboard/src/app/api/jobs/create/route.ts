import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { jobType = 'weekly_report', params = {} } = body

  let supabase: ReturnType<typeof supabaseAdmin>
  try { supabase = supabaseAdmin() } catch (e: any) {
    console.error('supabaseAdmin init failed:', e?.message)
    return NextResponse.json({ error: `Database config error: ${e?.message}` }, { status: 503 })
  }

  const { data, error } = await supabase
    .from('report_jobs')
    .insert({
      status: 'queued',
      job_type: jobType,
      params,
      phase: 0,
      phase_label: 'Queued — starting shortly',
      phase_data: {}
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('Failed to create job:', error)
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
  }

  return NextResponse.json({ jobId: data.id })
}
