import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Matches the runner's in-flight window: a run-marked phase older than this
// is presumed dead and is NOT counted as running
const IN_FLIGHT_MS = 10 * 60 * 1000

export async function GET(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const segments = req.nextUrl.pathname.split('/')
  const id = segments[segments.length - 1]
  if (!id) return NextResponse.json({ error: 'Missing job id' }, { status: 400 })

  const supabase = supabaseAdmin()
  const { data, error } = await supabase
    .from('report_jobs')
    .select('id, status, phase, phase_label, error, updated_at, params, job_type, phase_data')
    .eq('id', id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  // Compact per-phase progress for the client driver — phase_data itself is
  // large (all pulled report data) and never leaves the server
  const isLive = data.job_type === 'live_refresh'
  const total = isLive ? 11 : 22
  const ph = (data.phase_data as any)?._ph || {}
  const now = Date.now()
  let done = 0, running = 0
  for (const key of Object.keys(ph)) {
    const entry = ph[key]
    if (entry?.s === 'done') done++
    else if (entry?.s === 'run' && now - (entry.t || 0) < IN_FLIGHT_MS) running++
  }

  return NextResponse.json({
    id: data.id,
    status: data.status,
    phase: data.phase,
    phase_label: data.phase_label,
    error: data.error,
    updated_at: data.updated_at,
    params: data.params,
    phases: { total, done, running }
  })
}
