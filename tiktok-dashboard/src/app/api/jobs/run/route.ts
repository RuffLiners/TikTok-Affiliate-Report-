import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

// ── date windows ─────────────────────────────────────────────────────────────

function buildWindows(today: Date) {
  const gmvEnd    = subDays(today, 2)
  const gmvStart  = subDays(gmvEnd, 29)
  const priorEnd  = subDays(gmvStart, 1)
  const priorStart = subDays(priorEnd, 29)
  const dow = gmvEnd.getDay()
  const lastSat = dow === 6 ? gmvEnd : subDays(gmvEnd, dow + 1)
  const last7Start = subDays(lastSat, 6)
  const weeks = Array.from({ length: 13 }, (_, i) => {
    const wEnd = subDays(lastSat, i * 7); const wStart = subDays(wEnd, 6)
    return { start: wStart, end: wEnd }
  }).reverse()
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(today, 5 - i); const isPartial = i === 5
    return { key: format(d, 'yyyy-MM'), label: format(d, 'MMM') + (isPartial ? '*' : ''), start: startOfMonth(d), end: isPartial ? gmvEnd : endOfMonth(d) }
  })
  const f = (d: Date) => format(d, 'yyyy-MM-dd')
  return {
    reportDate: format(today, 'yyyy-MM-dd'), label: format(today, 'MMMM d, yyyy'),
    dataWindow: `${format(gmvStart, 'MMM d')} – ${format(gmvEnd, 'MMM d, yyyy')}`,
    d30: { start: f(gmvStart), end: f(gmvEnd) },
    prior: { start: f(priorStart), end: f(priorEnd) },
    last7: { start: f(last7Start), end: f(lastSat) },
    weeks, months,
    weekLabels: weeks.map(w => `${w.start.getMonth() + 1}/${w.start.getDate()}`),
    monthLabels: months.map(m => m.label),
    weeksRange: `${f(weeks[0].start)} to ${f(lastSat)}`,
    monthKeys: months.map(m => m.key).join(', ')
  }
}

// ── phase prompts (max 2 queries each) ───────────────────────────────────────

const HDR = (w: ReturnType<typeof buildWindows>) => `Data extraction agent for Ruff Liners TikTok Shop.
STORE ID: ${process.env.EUKA_STORE_ID}
Current 30d: ${w.d30.start} to ${w.d30.end}
Prior 30d: ${w.prior.start} to ${w.prior.end}
13 weeks: ${w.weeksRange} (Sun–Sat)
6 months: ${w.monthKeys}
RULES: Always specify 2026. Read every CSV with read_sandbox_file. Use creator_store_performance for GMV. New creators = first-ever video for this store. GMV Max only from May 14 2026 — use 0 if earlier.`

// Phase 1: current + prior 30d KPI totals (2 queries)
const p1 = (w: ReturnType<typeof buildWindows>) => HDR(w) + `

Run EXACTLY 2 queries:
[A1] Current 30d (${w.d30.start}–${w.d30.end}): total GMV, orders, videos posted, views, creators who posted, new creators (first-ever post for this store), retention rate
[A2] Prior 30d (${w.prior.start}–${w.prior.end}): same 7 fields

Output ONLY:
{"A1":{"gmv":0,"orders":0,"videos":0,"views":0,"creators":0,"newCreators":0,"retention":0},"A2":{"gmv":0,"orders":0,"videos":0,"views":0,"creators":0,"newCreators":0,"retention":0}}`

// Phase 2: tiers + GMV Max (2 queries)
const p2 = (w: ReturnType<typeof buildWindows>) => HDR(w) + `

Run EXACTLY 2 queries:
[A3] Current 30d by tier (G1=global gmv_30d <$25K, G2=$25K–$100K, G3=>$100K): creators, new creators, videos, store GMV
[A6] GMV Max current 30d: ad spend, attributed revenue, ROI

Output ONLY:
{"A3":{"g1":{"creators":0,"newCreators":0,"videos":0,"gmv":0},"g2":{"creators":0,"newCreators":0,"videos":0,"gmv":0},"g3":{"creators":0,"newCreators":0,"videos":0,"gmv":0}},"A6":{"spend":0,"revenue":0,"roi":0}}`

// Phase 3: outreach current + prior (2 queries)
const p3 = (w: ReturnType<typeof buildWindows>) => HDR(w) + `

Run EXACTLY 2 queries:
[A4] Current 30d outreach by tier: messages sent + samples shipped (totals + G1/G2/G3)
[A5] Prior 30d outreach by tier: same fields

Output ONLY:
{"A4":{"total":{"msgs":0,"samples":0},"g1":{"msgs":0,"samples":0},"g2":{"msgs":0,"samples":0},"g3":{"msgs":0,"samples":0}},"A5":{"total":{"msgs":0,"samples":0},"g1":{"msgs":0,"samples":0},"g2":{"msgs":0,"samples":0},"g3":{"msgs":0,"samples":0}}}`

// Phase 4: top creators + video GMV counts (2 queries)
const p4 = (w: ReturnType<typeof buildWindows>) => HDR(w) + `

Run EXACTLY 2 queries:
[B1] Top 15 creators by store GMV ${w.d30.start}–${w.d30.end}: handle, followers, store GMV, global gmv_30d, views, videos L30d, videos L7d, orders, AOV, engagement rate
[B2] For each B1 handle: count of videos with any store GMV in this period; lifetime total videos for this store

Output ONLY:
{"topCreators":[{"h":"","flw":0,"sgmv":0,"ggmv":0,"views":0,"v30":0,"vmgmv":0,"vlife":0,"v7":0,"ord":0,"aov":0,"eng":null}]}`

// Phase 5: top videos + active creators (2 queries)
const p5 = (w: ReturnType<typeof buildWindows>) => HDR(w) + `

Run EXACTLY 2 queries:
[B3] Top 15 videos by store GMV ${w.d30.start}–${w.d30.end}: creator handle, product (shorten long names), GMV, views, orders, AOV, publish date, likes, comments, product clicks
[B4] Top 15 creators by videos posted L30d: handle, global GMV, followers, videos posted, GMV from those videos, total store GMV, views, avg views, orders

Output ONLY:
{"topVideos":[{"h":"","ggmv":0,"prod":"","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":""}],"activeCreators":[{"h":"","ggmv":0,"flw":0,"v30":0,"gmvN":0,"gmvT":0,"views":0,"avgv":0,"ord":0}]}`

// Phase 6: 13-week GMV + tier (2 queries)
const p6 = (w: ReturnType<typeof buildWindows>) => HDR(w) + `

Run EXACTLY 2 queries:
[C1] 13 weeks GMV + orders for ${w.weeksRange} — 13 rows chronological
[C2] 13 weeks by tier (G1/G2/G3): creators, new creators, videos, store GMV — 39 rows total

Output ONLY (arrays must have exactly 13 items):
{"C1":[{"gmv":0,"orders":0}],"C2":{"g1":[{"creators":0,"newCreators":0,"videos":0,"gmv":0}],"g2":[{"creators":0,"newCreators":0,"videos":0,"gmv":0}],"g3":[{"creators":0,"newCreators":0,"videos":0,"gmv":0}]}}`

// Phase 7: 13-week retention + videos + outreach (3 queries but simpler ones)
const p7 = (w: ReturnType<typeof buildWindows>) => HDR(w) + `

Run EXACTLY 3 queries:
[C3] 13 weeks retention rate — 13 numbers
[C4] 13 weeks total videos posted + total views — 13 rows
[C5] 13 weeks outreach by tier: messages sent + samples shipped (G1/G2/G3) — 39 rows

Output ONLY (arrays must have exactly 13 items):
{"C3":[0],"C4":[{"videos":0,"views":0}],"C5":{"g1":[{"msgs":0,"samples":0}],"g2":[{"msgs":0,"samples":0}],"g3":[{"msgs":0,"samples":0}]}}`

// Phase 8: 6-month GMV + tier (2 queries)
const p8 = (w: ReturnType<typeof buildWindows>) => HDR(w) + `

Run EXACTLY 2 queries:
[D1] 6 months GMV + views for ${w.monthKeys} — 6 rows chronological
[D2] 6 months by tier (G1/G2/G3): creators, new creators, videos, store GMV — 18 rows

Output ONLY (arrays must have exactly 6 items):
{"D1":[{"gmv":0,"views":0}],"D2":{"g1":[{"creators":0,"newCreators":0,"videos":0,"gmv":0}],"g2":[{"creators":0,"newCreators":0,"videos":0,"gmv":0}],"g3":[{"creators":0,"newCreators":0,"videos":0,"gmv":0}]}}`

// Phase 9: 6-month retention + outreach (2 queries)
const p9 = (w: ReturnType<typeof buildWindows>) => HDR(w) + `

Run EXACTLY 2 queries:
[D3] 6 months retention rate — 6 numbers
[D4] 6 months outreach by tier: messages + samples (G1/G2/G3) — 18 rows

Output ONLY (arrays must have exactly 6 items):
{"D3":[0],"D4":{"g1":[{"msgs":0,"samples":0}],"g2":[{"msgs":0,"samples":0}],"g3":[{"msgs":0,"samples":0}]}}`

// Phase 10: analysis (no MCP)
function p10(w: ReturnType<typeof buildWindows>, pd: any) {
  const a1 = pd.A1 || {}; const a2 = pd.A2 || {}
  return `Senior analyst writing TikTok Shop affiliate report for Ruff Liners CEO.
DATA: GMV $${a1.gmv||0} (${a2.gmv ? Math.round(((a1.gmv-a2.gmv)/a2.gmv)*100) : 0}% vs prior), Orders ${a1.orders||0}, Videos ${a1.videos||0}, Creators ${a1.creators||0}, New ${a1.newCreators||0}, Retention ${a1.retention||0}%
GMV Max: Spend $${pd.A6?.spend||0}, Revenue $${pd.A6?.revenue||0}, ROI ${pd.A6?.roi||0}x
Full data: ${JSON.stringify(pd).slice(0,6000)}

Write 3 analyses. Output ONLY:
{"d30":"4-5 paragraphs\\n\\nbetween each","weekly":"3 paragraphs\\n\\nbetween each","monthly":"3 paragraphs\\n\\nbetween each"}`
}

// ── assemble final report ─────────────────────────────────────────────────────

function assemble(w: ReturnType<typeof buildWindows>, pd: any, analysis: any) {
  const a1=pd.A1||{}, a2=pd.A2||{}, a3=pd.A3||{g1:{},g2:{},g3:{}}, a4=pd.A4||{total:{},g1:{},g2:{},g3:{}}, a5=pd.A5||{total:{},g1:{},g2:{},g3:{}}, a6=pd.A6||{}
  const pct=(c:number,p:number)=>p?Math.round(((c-p)/p)*100):0
  const delta=(c:number,p:number)=>Math.round((c-p)*10)/10
  const c1=pd.C1||[], c2=pd.C2||{g1:[],g2:[],g3:[]}, c3=pd.C3||[], c4=pd.C4||[], c5=pd.C5||{g1:[],g2:[],g3:[]}
  const d1=pd.D1||[], d2=pd.D2||{g1:[],g2:[],g3:[]}, d3=pd.D3||[], d4=pd.D4||{g1:[],g2:[],g3:[]}
  return {
    report_date: w.reportDate, label: w.label, data_window: w.dataWindow,
    d30: {
      gmv:a1.gmv||0, gmvPct:pct(a1.gmv||0,a2.gmv||0), orders:a1.orders||0, ordersPct:pct(a1.orders||0,a2.orders||0),
      videos:a1.videos||0, videosPct:pct(a1.videos||0,a2.videos||0), views:a1.views||0, viewsPct:pct(a1.views||0,a2.views||0),
      creators:a1.creators||0, creatorsPct:pct(a1.creators||0,a2.creators||0), newCreators:a1.newCreators||0, newCreatorsPct:pct(a1.newCreators||0,a2.newCreators||0),
      retention:a1.retention||0, retentionDelta:delta(a1.retention||0,a2.retention||0),
      gmvMax:{spend:a6.spend||0,revenue:a6.revenue||0,roi:a6.roi||0},
      msgs:a4.total?.msgs||0, msgsPct:pct(a4.total?.msgs||0,a5.total?.msgs||0),
      samples:a4.total?.samples||0, samplesPct:pct(a4.total?.samples||0,a5.total?.samples||0),
      tiers:{
        g1:{creators:a3.g1?.creators||0,newCreators:a3.g1?.newCreators||0,videos:a3.g1?.videos||0,gmv:a3.g1?.gmv||0,msgs:a4.g1?.msgs||0,msgsPct:pct(a4.g1?.msgs||0,a5.g1?.msgs||0),samples:a4.g1?.samples||0,samplesPct:pct(a4.g1?.samples||0,a5.g1?.samples||0)},
        g2:{creators:a3.g2?.creators||0,newCreators:a3.g2?.newCreators||0,videos:a3.g2?.videos||0,gmv:a3.g2?.gmv||0,msgs:a4.g2?.msgs||0,msgsPct:pct(a4.g2?.msgs||0,a5.g2?.msgs||0),samples:a4.g2?.samples||0,samplesPct:pct(a4.g2?.samples||0,a5.g2?.samples||0)},
        g3:{creators:a3.g3?.creators||0,newCreators:a3.g3?.newCreators||0,videos:a3.g3?.videos||0,gmv:a3.g3?.gmv||0,msgs:a4.g3?.msgs||0,msgsPct:pct(a4.g3?.msgs||0,a5.g3?.msgs||0),samples:a4.g3?.samples||0,samplesPct:pct(a4.g3?.samples||0,a5.g3?.samples||0)}
      }
    },
    weekly_charts:{
      labels:w.weekLabels, gmv:c1.map((r:any)=>r.gmv||0), views:c4.map((r:any)=>r.views||0),
      crg1:c2.g1?.map((r:any)=>r.creators||0)||[], crg2:c2.g2?.map((r:any)=>r.creators||0)||[], crg3:c2.g3?.map((r:any)=>r.creators||0)||[],
      ncg1:c2.g1?.map((r:any)=>r.newCreators||0)||[], ncg2:c2.g2?.map((r:any)=>r.newCreators||0)||[], ncg3:c2.g3?.map((r:any)=>r.newCreators||0)||[],
      vg1:c2.g1?.map((r:any)=>r.videos||0)||[], vg2:c2.g2?.map((r:any)=>r.videos||0)||[], vg3:c2.g3?.map((r:any)=>r.videos||0)||[],
      gg1:c2.g1?.map((r:any)=>r.gmv||0)||[], gg2:c2.g2?.map((r:any)=>r.gmv||0)||[], gg3:c2.g3?.map((r:any)=>r.gmv||0)||[],
      ret:c3.map((r:any)=>typeof r==='number'?r:0), vid:c4.map((r:any)=>r.videos||0),
      mg1:c5.g1?.map((r:any)=>r.msgs||0)||[], mg2:c5.g2?.map((r:any)=>r.msgs||0)||[], mg3:c5.g3?.map((r:any)=>r.msgs||0)||[],
      sg1:c5.g1?.map((r:any)=>r.samples||0)||[], sg2:c5.g2?.map((r:any)=>r.samples||0)||[], sg3:c5.g3?.map((r:any)=>r.samples||0)||[]
    },
    monthly_charts:{
      labels:w.monthLabels, gmv:d1.map((r:any)=>r.gmv||0), views:d1.map((r:any)=>r.views||0),
      crg1:d2.g1?.map((r:any)=>r.creators||0)||[], crg2:d2.g2?.map((r:any)=>r.creators||0)||[], crg3:d2.g3?.map((r:any)=>r.creators||0)||[],
      ncg1:d2.g1?.map((r:any)=>r.newCreators||0)||[], ncg2:d2.g2?.map((r:any)=>r.newCreators||0)||[], ncg3:d2.g3?.map((r:any)=>r.newCreators||0)||[],
      vg1:d2.g1?.map((r:any)=>r.videos||0)||[], vg2:d2.g2?.map((r:any)=>r.videos||0)||[], vg3:d2.g3?.map((r:any)=>r.videos||0)||[],
      gg1:d2.g1?.map((r:any)=>r.gmv||0)||[], gg2:d2.g2?.map((r:any)=>r.gmv||0)||[], gg3:d2.g3?.map((r:any)=>r.gmv||0)||[],
      ret:d3.map((r:any)=>typeof r==='number'?r:0),
      mg1:d4.g1?.map((r:any)=>r.msgs||0)||[], mg2:d4.g2?.map((r:any)=>r.msgs||0)||[], mg3:d4.g3?.map((r:any)=>r.msgs||0)||[],
      sg1:d4.g1?.map((r:any)=>r.samples||0)||[], sg2:d4.g2?.map((r:any)=>r.samples||0)||[], sg3:d4.g3?.map((r:any)=>r.samples||0)||[]
    },
    tables:{topCreators:pd.topCreators||[], topVideos:pd.topVideos||[], activeCreators:pd.activeCreators||[]},
    analysis:{d30:analysis?.d30||'', weekly:analysis?.weekly||'', monthly:analysis?.monthly||''}
  }
}

// ── claude caller ─────────────────────────────────────────────────────────────

async function callClaude(prompt: string, apiKey: string, withMcp: boolean): Promise<string> {
  const body: any = { model: 'claude-sonnet-4-6', max_tokens: 6000, messages: [{ role: 'user', content: prompt }] }
  if (withMcp) {
    const raw = (process.env.EUKA_BEARER_TOKEN || '').trim()
    const tok = raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw
    const srv: any = { type: 'url', url: process.env.EUKA_MCP_URL!, name: 'euka' }
    if (tok) srv.authorization_token = tok
    body.mcp_servers = [srv]
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'mcp-client-2025-04-04' },
    body: JSON.stringify(body)
  })
  if (!res.ok) { const t = await res.text(); throw new Error(`Claude API error ${res.status}: ${t.slice(0,300)}`) }
  const data = await res.json()
  return (data.content||[]).filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n')
}

function extractJson(text: string): any {
  const s = text.indexOf('{'); const e = text.lastIndexOf('}')
  if (s===-1||e===-1) throw new Error('No JSON in response')
  return JSON.parse(text.slice(s, e+1))
}

async function getAnthropicKey(): Promise<string|null> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try { const sb=supabaseAdmin(); const {data}=await sb.from('app_config').select('value').eq('key','anthropic_api_key').single(); return (data?.value as string)??null } catch { return null }
}

// ── PHASE MAP ─────────────────────────────────────────────────────────────────
// Phase 1: A1+A2  (current + prior KPIs)
// Phase 2: A3+A6  (tiers + GMV Max)
// Phase 3: A4+A5  (outreach both periods)
// [live_refresh saves here]
// Phase 4: B1+B2  (top creators)
// Phase 5: B3+B4  (top videos + active creators)
// Phase 6: C1+C2  (13-week GMV + tier)
// Phase 7: C3+C4+C5 (13-week retention/videos/outreach)
// Phase 8: D1+D2  (6-month GMV + tier)
// Phase 9: D3+D4  (6-month retention + outreach)
// Phase 10: analysis
// Phase 11: save

export async function POST(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { jobId } = body
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

  const supabase = supabaseAdmin()
  const { data: job, error: jobErr } = await supabase.from('report_jobs').select('*').eq('id', jobId).single()
  if (jobErr || !job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  if (job.status === 'done') return NextResponse.json({ ok: true, nextPhase: null })
  if (job.status === 'error') return NextResponse.json({ ok: false, status: 'error', error: job.error })

  await supabase.from('report_jobs').update({ status: 'running', updated_at: new Date().toISOString() }).eq('id', jobId)

  const apiKey = await getAnthropicKey()
  if (!apiKey) {
    await supabase.from('report_jobs').update({ status: 'error', error: 'Anthropic API key not configured', updated_at: new Date().toISOString() }).eq('id', jobId)
    return NextResponse.json({ error: 'API key not configured' }, { status: 503 })
  }

  const params = job.params || {}
  const today = params.today ? new Date(params.today) : new Date()
  const w = buildWindows(today)
  const isLive = job.job_type === 'live_refresh'
  const pd = { ...(job.phase_data || {}) }
  const nextPhase = (job.phase || 0) + 1

  const upd = async (phase: number, label: string, extra?: any) => {
    await supabase.from('report_jobs').update({ phase, phase_label: label, phase_data: pd, updated_at: new Date().toISOString(), ...extra }).eq('id', jobId)
  }

  const PHASE_LABELS: Record<number,string> = {
    1:'Pulling current & prior KPIs…', 2:'Pulling creator tiers & GMV Max…', 3:'Pulling outreach data…',
    4:'Pulling top creators…', 5:'Pulling top videos…', 6:'Pulling 13-week trends…',
    7:'Pulling 13-week retention & outreach…', 8:'Pulling 6-month data…', 9:'Pulling 6-month trends…',
    10:'Writing analysis…', 11:'Saving report…'
  }

  try {
    await upd(nextPhase, PHASE_LABELS[nextPhase] || `Phase ${nextPhase}…`)

    if (nextPhase === 1) {
      const text = await callClaude(p1(w), apiKey, true)
      Object.assign(pd, extractJson(text))
    } else if (nextPhase === 2) {
      const text = await callClaude(p2(w), apiKey, true)
      Object.assign(pd, extractJson(text))
    } else if (nextPhase === 3) {
      const text = await callClaude(p3(w), apiKey, true)
      Object.assign(pd, extractJson(text))

      if (isLive) {
        // live_refresh saves after phase 3 (all KPI data collected)
        await upd(3, 'Saving live data…')
        const report = assemble(w, pd, { d30: '', weekly: '', monthly: '' })
        await supabase.from('weekly_reports').upsert(report, { onConflict: 'report_date' })
        await supabase.from('report_jobs').update({ status: 'done', phase: 3, phase_label: 'Done ✓', updated_at: new Date().toISOString() }).eq('id', jobId)
        return NextResponse.json({ ok: true, nextPhase: null })
      }
    } else if (nextPhase === 4) {
      const text = await callClaude(p4(w), apiKey, true)
      Object.assign(pd, extractJson(text))
    } else if (nextPhase === 5) {
      const text = await callClaude(p5(w), apiKey, true)
      Object.assign(pd, extractJson(text))
    } else if (nextPhase === 6) {
      const text = await callClaude(p6(w), apiKey, true)
      Object.assign(pd, extractJson(text))
    } else if (nextPhase === 7) {
      const text = await callClaude(p7(w), apiKey, true)
      Object.assign(pd, extractJson(text))
    } else if (nextPhase === 8) {
      const text = await callClaude(p8(w), apiKey, true)
      Object.assign(pd, extractJson(text))
    } else if (nextPhase === 9) {
      const text = await callClaude(p9(w), apiKey, true)
      Object.assign(pd, extractJson(text))
    } else if (nextPhase === 10) {
      const text = await callClaude(p10(w, pd), apiKey, false)
      pd.analysis = extractJson(text)
    } else if (nextPhase === 11) {
      const report = assemble(w, pd, pd.analysis || {})
      await supabase.from('weekly_reports').upsert(report, { onConflict: 'report_date' })
      await supabase.from('report_jobs').update({ status: 'done', phase: 11, phase_label: 'Complete ✓', updated_at: new Date().toISOString() }).eq('id', jobId)
      return NextResponse.json({ ok: true, nextPhase: null })
    } else {
      await supabase.from('report_jobs').update({ status: 'done', phase_label: 'Complete ✓', updated_at: new Date().toISOString() }).eq('id', jobId)
      return NextResponse.json({ ok: true, nextPhase: null })
    }

    await upd(nextPhase, `Phase ${nextPhase} done`)
    return NextResponse.json({ ok: true, nextPhase: nextPhase + 1 })

  } catch (err: any) {
    const msg = err?.message || 'Unknown error'
    console.error(`Job ${jobId} phase ${nextPhase} error:`, msg)
    await supabase.from('report_jobs').update({ status: 'error', error: msg.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', jobId)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
