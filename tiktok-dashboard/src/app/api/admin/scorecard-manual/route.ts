import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { MANUAL_KEYS, CHECK_ONLY_KEYS, LineKey } from '@/lib/scorecard'

export const dynamic = 'force-dynamic'
// /api/admin/* is behind the admin cookie in proxy.ts; the cookie check here is belt and braces.
const authed = (req: NextRequest) => !!req.cookies.get('rl-auth')?.value

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { data, error } = await supabaseAdmin().from('scorecard_manual').select('*').order('period_key', { ascending: false }).limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ entries: data })
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const enteredBy = String(body?.enteredBy ?? '').trim()
  if (!enteredBy) return NextResponse.json({ error: 'Enter your name so the value can be attributed' }, { status: 400 })
  const list: any[] = Array.isArray(body?.entries) ? body.entries : []
  if (!list.length) return NextResponse.json({ error: 'No entries' }, { status: 400 })
  const supabase = supabaseAdmin()
  const now = new Date().toISOString()
  const errors: string[] = []
  let saved = 0
  for (const e of list) {
    const t = e?.period_type, k = String(e?.period_key ?? ''), line = e?.line as LineKey
    const v = e?.value === '' || e?.value == null ? NaN : Number(e.value)
    if (t !== 'week' && t !== 'month' && t !== 'month_check') { errors.push('period_type must be week, month or month_check'); continue }
    if (t !== 'week' ? !/^\d{4}-\d{2}$/.test(k) : !/^\d{4}-\d{2}-\d{2}$/.test(k)) { errors.push(`bad period_key ${k}`); continue }
    if (!(t === 'month_check' ? CHECK_ONLY_KEYS : MANUAL_KEYS).includes(line)) { errors.push(`line ${line} is not allowed for ${t}`); continue }
    if (!Number.isFinite(v) || v < 0) { errors.push(`${line}: value must be a non-negative number`); continue }
    const { data: old } = await supabase.from('scorecard_manual').select('value').eq('period_type', t).eq('period_key', k).eq('line', line).maybeSingle()
    const { error } = await supabase.from('scorecard_manual').upsert(
      { period_type: t, period_key: k, line, value: v, source: 'manual', entered_by: enteredBy, entered_at: now },
      { onConflict: 'period_type,period_key,line' })
    if (error) { errors.push(`${line}: ${error.message}`); continue }
    await supabase.from('scorecard_manual_log').insert({ by: enteredBy, action: old ? 'update' : 'create', period_type: t, period_key: k, line, old_value: old?.value ?? null, new_value: v })
    saved++
  }
  return NextResponse.json({ ok: !errors.length, saved, errors }, { status: errors.length && !saved ? 422 : 200 })
}

export async function DELETE(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const p = req.nextUrl.searchParams
  const t = p.get('period_type'), k = p.get('period_key'), line = p.get('line'), by = p.get('by') || 'unknown'
  if (!t || !k || !line) return NextResponse.json({ error: 'period_type, period_key and line are required' }, { status: 400 })
  const supabase = supabaseAdmin()
  const { data: old } = await supabase.from('scorecard_manual').select('value').eq('period_type', t).eq('period_key', k).eq('line', line).maybeSingle()
  const { error } = await supabase.from('scorecard_manual').delete().eq('period_type', t).eq('period_key', k).eq('line', line)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await supabase.from('scorecard_manual_log').insert({ by, action: 'delete', period_type: t, period_key: k, line, old_value: old?.value ?? null, new_value: null })
  return NextResponse.json({ ok: true })
}
