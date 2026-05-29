import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { subDays, format, startOfMonth, endOfMonth, subMonths } from 'date-fns'

export const dynamic = 'force-dynamic'

function buildWindows(today: Date) {
  const gmvEnd = subDays(today, 2), gmvStart = subDays(gmvEnd, 29)
  const priorEnd = subDays(gmvStart, 1), priorStart = subDays(priorEnd, 29)
  const dow = gmvEnd.getDay()
  const lastSat = dow === 6 ? gmvEnd : subDays(gmvEnd, dow + 1)
  const weeks = Array.from({ length: 13 }, (_, i) => {
    const wEnd = subDays(lastSat, i * 7); return { start: subDays(wEnd, 6), end: wEnd }
  }).reverse()
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(today, 5 - i); const ip = i === 5
    return { key: format(d, 'yyyy-MM'), label: format(d, 'MMM') + (ip ? '*' : ''), start: startOfMonth(d), end: ip ? gmvEnd : endOfMonth(d) }
  })
  const f = (d: Date) => format(d, 'yyyy-MM-dd')
  return {
    reportDate: format(today, 'yyyy-MM-dd'),
    label: format(today, 'MMMM d, yyyy'),
    dataWindow: `${format(gmvStart, 'MMM d')} – ${format(gmvEnd, 'MMM d, yyyy')}`,
    d30: { start: f(gmvStart), end: f(gmvEnd) },
    prior: { start: f(priorStart), end: f(priorEnd) },
    weekLabels: weeks.map(w => `${w.start.getMonth()+1}/${w.start.getDate()}`),
    monthLabels: months.map(m => m.label),
  }
}

function pct(c: number, p: number) { return p ? Math.round(((c - p) / p) * 100) : 0 }
function delta(c: number, p: number) { return Math.round((c - p) * 10) / 10 }

function assembled30(pd: any, w: ReturnType<typeof buildWindows>) {
  const a1 = pd.A1 || {}, a2 = pd.A2 || {}
  const a3 = pd.A3 || { g1: {}, g2: {}, g3: {} }
  const a4 = pd.A4 || { total: {}, g1: {}, g2: {}, g3: {} }
  const a5 = pd.A5 || { total: {}, g1: {}, g2: {}, g3: {} }
  const a6 = pd.A6 || {}
  return {
    label: w.label,
    data_window: w.dataWindow,
    d30: {
      gmv: a1.gmv || 0, gmvPct: pct(a1.gmv || 0, a2.gmv || 0),
      orders: a1.orders || 0, ordersPct: pct(a1.orders || 0, a2.orders || 0),
      videos: a1.videos || 0, videosPct: pct(a1.videos || 0, a2.videos || 0),
      views: a1.views || 0, viewsPct: pct(a1.views || 0, a2.views || 0),
      creators: a1.creators || 0, creatorsPct: pct(a1.creators || 0, a2.creators || 0),
      newCreators: a1.newCreators || 0, newCreatorsPct: pct(a1.newCreators || 0, a2.newCreators || 0),
      retention: a1.retention || 0, retentionDelta: delta(a1.retention || 0, a2.retention || 0),
      gmvMax: { spend: a6.spend || 0, revenue: a6.revenue || 0, roi: a6.roi || 0 },
      msgs: a4.total?.msgs || 0, msgsPct: pct(a4.total?.msgs || 0, a5.total?.msgs || 0),
      samples: a4.total?.samples || 0, samplesPct: pct(a4.total?.samples || 0, a5.total?.samples || 0),
      tiers: {
        g1: { creators: a3.g1?.creators||0, newCreators: a3.g1?.newCreators||0, videos: a3.g1?.videos||0, gmv: a3.g1?.gmv||0, msgs: a4.g1?.msgs||0, msgsPct: pct(a4.g1?.msgs||0,a5.g1?.msgs||0), samples: a4.g1?.samples||0, samplesPct: pct(a4.g1?.samples||0,a5.g1?.samples||0) },
        g2: { creators: a3.g2?.creators||0, newCreators: a3.g2?.newCreators||0, videos: a3.g2?.videos||0, gmv: a3.g2?.gmv||0, msgs: a4.g2?.msgs||0, msgsPct: pct(a4.g2?.msgs||0,a5.g2?.msgs||0), samples: a4.g2?.samples||0, samplesPct: pct(a4.g2?.samples||0,a5.g2?.samples||0) },
        g3: { creators: a3.g3?.creators||0, newCreators: a3.g3?.newCreators||0, videos: a3.g3?.videos||0, gmv: a3.g3?.gmv||0, msgs: a4.g3?.msgs||0, msgsPct: pct(a4.g3?.msgs||0,a5.g3?.msgs||0), samples: a4.g3?.samples||0, samplesPct: pct(a4.g3?.samples||0,a5.g3?.samples||0) },
      }
    }
  }
}

// POST — accept A1-A6 phase data, assemble d30, merge into report for report_date
export async function POST(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { phaseData, reportDate } = body
  if (!phaseData || !phaseData.A1) return NextResponse.json({ error: 'Missing phaseData.A1' }, { status: 400 })

  let supabase: ReturnType<typeof supabaseAdmin>
  try { supabase = supabaseAdmin() } catch (e: any) {
    return NextResponse.json({ error: `DB config error: ${e?.message}` }, { status: 503 })
  }

  const today = reportDate ? new Date(reportDate + 'T12:00:00') : new Date()
  const w = buildWindows(today)
  const assembled = assembled30(phaseData, w)

  // Check if a report exists for this date
  const { data: existing } = await supabase
    .from('weekly_reports')
    .select('report_date, weekly_charts, monthly_charts, tables, analysis, agents')
    .eq('report_date', w.reportDate)
    .maybeSingle()

  if (existing) {
    // Merge: update only d30 + label + data_window, preserve everything else
    const { error } = await supabase
      .from('weekly_reports')
      .update({ d30: assembled.d30, label: assembled.label, data_window: assembled.data_window })
      .eq('report_date', w.reportDate)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    // Insert a new report (charts/tables will be empty — can run full auto-generate later)
    const { error } = await supabase.from('weekly_reports').insert({
      report_date: w.reportDate,
      label: assembled.label,
      data_window: assembled.data_window,
      d30: assembled.d30,
      weekly_charts: { labels:[], gmv:[], views:[], crg1:[], crg2:[], crg3:[], ncg1:[], ncg2:[], ncg3:[], vg1:[], vg2:[], vg3:[], gg1:[], gg2:[], gg3:[], ret:[], vid:[], mg1:[], mg2:[], mg3:[], sg1:[], sg2:[], sg3:[] },
      monthly_charts: { labels:[], gmv:[], views:[], crg1:[], crg2:[], crg3:[], ncg1:[], ncg2:[], ncg3:[], vg1:[], vg2:[], vg3:[], gg1:[], gg2:[], gg3:[], ret:[], mg1:[], mg2:[], mg3:[], sg1:[], sg2:[], sg3:[] },
      tables: { topCreators:[], topVideos:[], activeCreators:[] },
      analysis: { d30:'', weekly:'', monthly:'' }
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  revalidatePath('/dashboard')
  return NextResponse.json({ ok: true, reportDate: w.reportDate, gmv: assembled.d30.gmv })
}

// GET — return the Claude prompts with live date windows filled in
export async function GET(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const reportDate = searchParams.get('reportDate')
  const today = reportDate ? new Date(reportDate + 'T12:00:00') : new Date()
  const w = buildWindows(today)
  const storeId = process.env.EUKA_STORE_ID || 'YOUR_STORE_ID'

  const base = `You are a data extraction agent for Ruff Liners TikTok Shop. STORE ID: ${storeId}
Current 30d: ${w.d30.start} to ${w.d30.end} | Prior 30d: ${w.prior.start} to ${w.prior.end}
RULES: Always specify year 2026 in queries. Read every CSV with read_sandbox_file. Use creator_store_performance for GMV. New creators = first-ever video for this store. GMV Max only from May 14 2026 (use 0 if earlier).
CRITICAL OUTPUT RULE: You MUST respond with ONLY a single JSON object. Start with { and end with }. No prose, no markdown.`

  const prompts = [
    {
      phase: 1,
      label: 'Current 30-day KPIs',
      key: 'A1',
      prompt: `${base}

Query: Current 30d (${w.d30.start}–${w.d30.end}) totals from creator_store_performance: total GMV, orders, videos posted, views, total creators who posted, new creators (first-ever post for this store), retention rate.
Output: {"A1":{"gmv":0,"orders":0,"videos":0,"views":0,"creators":0,"newCreators":0,"retention":0}}`
    },
    {
      phase: 2,
      label: 'Prior 30-day KPIs (for % change)',
      key: 'A2',
      prompt: `${base}

Query: Prior 30d (${w.prior.start}–${w.prior.end}) totals from creator_store_performance: total GMV, orders, videos posted, views, total creators who posted, new creators (first-ever post for this store), retention rate.
Output: {"A2":{"gmv":0,"orders":0,"videos":0,"views":0,"creators":0,"newCreators":0,"retention":0}}`
    },
    {
      phase: 3,
      label: 'Creator tier breakdown',
      key: 'A3',
      prompt: `${base}

Query: Current 30d (${w.d30.start}–${w.d30.end}) by creator tier (tier based on global gmv_30d: G1 <$25K, G2 $25K–$100K, G3 >$100K): creators who posted, new creators, videos posted, store GMV. Output ONLY the JSON — no analysis.
Output: {"A3":{"g1":{"creators":0,"newCreators":0,"videos":0,"gmv":0},"g2":{"creators":0,"newCreators":0,"videos":0,"gmv":0},"g3":{"creators":0,"newCreators":0,"videos":0,"gmv":0}}}`
    },
    {
      phase: 4,
      label: 'Current outreach (messages + samples)',
      key: 'A4',
      prompt: `${base}

Query: Current 30d (${w.d30.start}–${w.d30.end}) outreach totals + by tier (G1 <$25K, G2 $25K–$100K, G3 >$100K): messages sent, samples shipped.
Output: {"A4":{"total":{"msgs":0,"samples":0},"g1":{"msgs":0,"samples":0},"g2":{"msgs":0,"samples":0},"g3":{"msgs":0,"samples":0}}}`
    },
    {
      phase: 5,
      label: 'Prior outreach (for % change)',
      key: 'A5',
      prompt: `${base}

Query: Prior 30d (${w.prior.start}–${w.prior.end}) outreach totals + by tier (G1 <$25K, G2 $25K–$100K, G3 >$100K): messages sent, samples shipped.
Output: {"A5":{"total":{"msgs":0,"samples":0},"g1":{"msgs":0,"samples":0},"g2":{"msgs":0,"samples":0},"g3":{"msgs":0,"samples":0}}}`
    },
    {
      phase: 6,
      label: 'GMV Max (ad spend + revenue)',
      key: 'A6',
      prompt: `${base}

Query: GMV Max current 30d (${w.d30.start}–${w.d30.end}): total ad spend, attributed revenue, blended ROI. Use 0 if data unavailable before May 14 2026.
Output: {"A6":{"spend":0,"revenue":0,"roi":0}}`
    },
  ]

  return NextResponse.json({ prompts, reportDate: w.reportDate, dataWindow: w.dataWindow })
}
