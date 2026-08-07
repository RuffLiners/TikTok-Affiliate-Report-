import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('dash-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { jobType = 'weekly_report', params = {} } = body

  let supabase: ReturnType<typeof supabaseAdmin>
  try { supabase = supabaseAdmin() } catch (e: any) {
    console.error('supabaseAdmin init failed:', e?.message)
    return NextResponse.json({ error: `Database config error: ${e?.message}` }, { status: 503 })
  }

  // Reattach instead of restart: the browser drives jobs, so a connectivity
  // blip aborts the client while the server-side job keeps running. If a job
  // for the same report is already in flight and recently active, hand back
  // its id — completed phases are kept and the driver resumes where it was.
  const REATTACH_WINDOW_MS = 30 * 60 * 1000
  const { data: inflight } = await supabase
    .from('report_jobs')
    .select('id, params, updated_at')
    .eq('job_type', jobType)
    .in('status', ['queued', 'running'])
    .gte('updated_at', new Date(Date.now() - REATTACH_WINDOW_MS).toISOString())
    .order('updated_at', { ascending: false })
    .limit(5)
  const match = (inflight ?? []).find(j =>
    (j.params?.today ?? null) === (params.today ?? null) &&
    (j.params?.month ?? null) === (params.month ?? null)
  )
  if (match) return NextResponse.json({ jobId: match.id, resumed: true })

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
