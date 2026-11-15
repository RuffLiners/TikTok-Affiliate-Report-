import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { parseSellerCenterCsv } from '@/lib/scorecard'

export const dynamic = 'force-dynamic'

// One-time (and re-runnable) Seller Center history import. dryRun=true validates and counts without writing.
export async function POST(req: NextRequest) {
  if (!req.cookies.get('rl-auth')?.value) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const csv = String(body?.csv ?? '')
  const enteredBy = String(body?.enteredBy ?? '').trim()
  if (!enteredBy) return NextResponse.json({ error: 'Enter your name so the import can be attributed' }, { status: 400 })
  const parsed = parseSellerCenterCsv(csv, 'seller_center', `${enteredBy} (csv import)`)
  if (parsed.errors.length) return NextResponse.json({ ok: false, errors: parsed.errors.slice(0, 20) }, { status: 422 })
  if (body?.dryRun) return NextResponse.json({ ok: true, dryRun: true, wouldSave: parsed.entries.length, blankCellsSkipped: parsed.skipped })
  const supabase = supabaseAdmin()
  const rows = parsed.entries.map(e => ({ period_type: e.period_type, period_key: e.period_key, line: e.line, value: e.value, source: e.source, entered_by: e.entered_by, entered_at: e.entered_at }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('scorecard_manual').upsert(rows.slice(i, i + 500), { onConflict: 'period_type,period_key,line' })
    if (error) return NextResponse.json({ ok: false, errors: [error.message], savedBeforeError: i }, { status: 500 })
  }
  await supabase.from('scorecard_manual_log').insert({ by: enteredBy, action: 'csv-import', new_value: rows.length })
  return NextResponse.json({ ok: true, saved: rows.length, blankCellsSkipped: parsed.skipped })
}
