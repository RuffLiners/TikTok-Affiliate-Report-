import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function hash(pw: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { reportDate, password } = await req.json().catch(() => ({}))
  if (!reportDate) return NextResponse.json({ error: 'Missing reportDate' }, { status: 400 })
  if (!password) return NextResponse.json({ error: 'Super admin password required' }, { status: 400 })

  const supabase = supabaseAdmin()

  // Verify super admin password
  const { data: config } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'super_admin_password_hash')
    .single()

  if (!config) return NextResponse.json({ error: 'No super admin password set. Set one in Admin → Manage → Security.' }, { status: 403 })

  const inputHash = await hash(password)
  if (inputHash !== config.value) return NextResponse.json({ error: 'Incorrect password' }, { status: 401 })

  const { error } = await supabase
    .from('weekly_reports')
    .delete()
    .eq('report_date', reportDate)

  if (error) return NextResponse.json({ error: 'Delete failed: ' + error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
