import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET — check if a key is stored (returns masked version, not the real key)
export async function GET(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const supabase = supabaseAdmin()
  const { data } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'anthropic_api_key')
    .single()

  if (!data?.value) {
    const hasEnv = !!process.env.ANTHROPIC_API_KEY
    return NextResponse.json({ set: hasEnv, source: hasEnv ? 'env' : 'none', masked: hasEnv ? 'sk-ant-···' : null })
  }

  const v = data.value as string
  const masked = v.length > 12 ? v.slice(0, 10) + '···' + v.slice(-4) : '···'
  return NextResponse.json({ set: true, source: 'db', masked })
}

// POST — save or update the API key
export async function POST(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { apiKey } = await req.json().catch(() => ({}))
  if (!apiKey?.trim()) return NextResponse.json({ error: 'API key is required' }, { status: 400 })
  if (!apiKey.startsWith('sk-ant-')) return NextResponse.json({ error: 'Invalid Anthropic API key format — must start with sk-ant-' }, { status: 400 })

  const supabase = supabaseAdmin()
  const { error } = await supabase
    .from('app_config')
    .upsert({ key: 'anthropic_api_key', value: apiKey.trim(), updated_at: new Date().toISOString() })

  if (error) return NextResponse.json({ error: 'Failed to save API key' }, { status: 500 })

  const masked = apiKey.slice(0, 10) + '···' + apiKey.slice(-4)
  return NextResponse.json({ ok: true, masked })
}

// DELETE — remove the stored key (will fall back to env var)
export async function DELETE(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const supabase = supabaseAdmin()
  await supabase.from('app_config').delete().eq('key', 'anthropic_api_key')

  return NextResponse.json({ ok: true })
}
