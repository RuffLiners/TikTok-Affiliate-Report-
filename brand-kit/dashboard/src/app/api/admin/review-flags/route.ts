import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Reviewed/expected report warnings. Each auto-generated report's sanity
// flags carry a stable key (d30.reviewFlagKeys); a human who has verified a
// flagged number against Euka adds its key here, and future runs demote that
// exact warning from NEEDS REVIEW to an informational "Reviewed/expected"
// note — so a known one-time correction (e.g. the 2026-08 views-source fix
// that legitimately moved 30d views +182%) doesn't re-fire forever.

async function readKeys(supabase: ReturnType<typeof supabaseAdmin>): Promise<string[]> {
  const { data } = await supabase.from('app_config').select('value').eq('key', 'reviewed_flags').single()
  if (!data?.value) return []
  try {
    const parsed = JSON.parse(data.value)
    return Array.isArray(parsed) ? parsed.filter(k => typeof k === 'string') : []
  } catch {
    return []
  }
}

// GET — list reviewed flag keys
export async function GET(req: NextRequest) {
  const token = req.cookies.get('dash-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const supabase = supabaseAdmin()
  return NextResponse.json({ reviewed: await readKeys(supabase) })
}

// POST — { add?: string[], remove?: string[] } mutate the reviewed set
export async function POST(req: NextRequest) {
  const token = req.cookies.get('dash-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const add: string[] = Array.isArray(body?.add) ? body.add.filter((k: unknown) => typeof k === 'string') : []
  const remove: string[] = Array.isArray(body?.remove) ? body.remove.filter((k: unknown) => typeof k === 'string') : []
  if (!add.length && !remove.length) {
    return NextResponse.json({ error: 'Provide add[] and/or remove[] flag keys' }, { status: 400 })
  }

  const supabase = supabaseAdmin()
  const current = new Set(await readKeys(supabase))
  for (const k of add) current.add(k)
  for (const k of remove) current.delete(k)

  const { error } = await supabase
    .from('app_config')
    .upsert({ key: 'reviewed_flags', value: JSON.stringify([...current]), updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: 'Failed to save reviewed flags' }, { status: 500 })

  return NextResponse.json({ ok: true, reviewed: [...current] })
}
