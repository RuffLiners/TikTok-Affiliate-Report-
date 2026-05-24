import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function hash(pw: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// GET — check whether a super admin password has been set
export async function GET(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const supabase = supabaseAdmin()
  const { data } = await supabase
    .from('app_config')
    .select('key')
    .eq('key', 'super_admin_password_hash')
    .single()

  return NextResponse.json({ set: !!data })
}

// POST — set (first time) or change the super admin password
export async function POST(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { newPassword, currentPassword } = await req.json().catch(() => ({}))
  if (!newPassword?.trim()) return NextResponse.json({ error: 'New password is required' }, { status: 400 })

  const supabase = supabaseAdmin()

  // Check if one is already set
  const { data: existing } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'super_admin_password_hash')
    .single()

  if (existing) {
    // Changing — verify current password first
    if (!currentPassword) return NextResponse.json({ error: 'Current password is required to change it' }, { status: 400 })
    const currentHash = await hash(currentPassword)
    if (currentHash !== existing.value) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 })
  }

  const newHash = await hash(newPassword)
  const { error } = await supabase
    .from('app_config')
    .upsert({ key: 'super_admin_password_hash', value: newHash, updated_at: new Date().toISOString() })

  if (error) return NextResponse.json({ error: 'Failed to save password' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
