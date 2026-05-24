import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET — retrieve goals from app_config
export async function GET(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const supabase = supabaseAdmin()
  const { data } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'goals')
    .single()

  if (!data) return NextResponse.json({})

  try {
    const goals = JSON.parse(data.value)
    return NextResponse.json(goals)
  } catch {
    return NextResponse.json({})
  }
}

// POST — save goals to app_config
export async function POST(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const goals = await req.json().catch(() => ({}))

  const supabase = supabaseAdmin()
  const { error } = await supabase
    .from('app_config')
    .upsert({ key: 'goals', value: JSON.stringify(goals), updated_at: new Date().toISOString() })

  if (error) return NextResponse.json({ error: 'Failed to save goals' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
