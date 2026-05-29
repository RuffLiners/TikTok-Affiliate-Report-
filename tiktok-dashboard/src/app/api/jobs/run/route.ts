import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns'

export const maxDuration = 800
export const dynamic = 'force-dynamic'

function buildWindows(today: Date) {
  const gmvEnd = subDays(today, 2), gmvStart = subDays(gmvEnd, 29)
  const priorEnd = subDays(gmvStart, 1), priorStart = subDays(priorEnd, 29)
  const dow = gmvEnd.getDay()
  const lastSat = dow === 6 ? gmvEnd : subDays(gmvEnd, dow + 1)
  const last7Start = subDays(lastSat, 6)
  const weeks = Array.from({ length: 13 }, (_, i) => {
    const wEnd = subDays(lastSat, i * 7); return { start: subDays(wEnd, 6), end: wEnd }
  }).reverse()
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(today, 5 - i); const ip = i === 5
    return { key: format(d, 'yyyy-MM'), label: format(d, 'MMM') + (ip ? '*' : ''), start: startOfMonth(d), end: ip ? gmvEnd : endOfMonth(d) }
  })
  const f = (d: Date) => format(d, 'yyyy-MM-dd')
  return {
    reportDate: format(today, 'yyyy-MM-dd'), label: format(today, 'MMMM d, yyyy'),
    dataWindow: `${format(gmvStart, 'MMM d')} – ${format(gmvEnd, 'MMM d, yyyy')}`,
    d30: { start: f(gmvStart), end: f(gmvEnd) }, prior: { start: f(priorStart), end: f(priorEnd) },
    last7: { start: f(last7Start), end: f(lastSat) }, weeks, months,
    weekLabels: weeks.map(w => `${w.start.getMonth()+1}/${w.start.getDate()}`),
    monthLabels: months.map(m => m.label),
    weeksRange: `${f(weeks[0].start)} to ${f(lastSat)}`,
    monthKeys: months.map(m => m.key).join(', ')
  }
}

const BASE = (w: ReturnType<typeof buildWindows>) =>
  `Data extraction agent for Ruff Liners TikTok Shop. STORE ID: ${process.env.EUKA_STORE_ID}
Current 30d: ${w.d30.start} to ${w.d30.end} | Prior 30d: ${w.prior.start} to ${w.prior.end}
13 weeks: ${w.weeksRange} | 6 months: ${w.monthKeys}
RULES: Specify 2026 in all queries. Read every CSV with read_sandbox_file. Use creator_store_performance for GMV. New creators = first-ever video for this store. GMV Max only from May 14 2026 (use 0 if earlier).
Output ONLY the JSON object requested — no explanation, no markdown.`

// ONE query per phase — each phase is one Vercel function call (maxDuration=800)
const PHASES: Record<number, { label: string; prompt: (w: ReturnType<typeof buildWindows>, pd: any) => string; mcp: boolean }> = {
  1: {
    label: 'Pulling current 30-day KPIs…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Current 30d (${w.d30.start}–${w.d30.end}) totals from creator_store_performance: total GMV, orders, videos posted, views, total creators who posted, new creators (first-ever post for this store), retention rate.\nOutput: {"A1":{"gmv":0,"orders":0,"videos":0,"views":0,"creators":0,"newCreators":0,"retention":0}}`
  },
  2: {
    label: 'Pulling prior 30-day KPIs…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Prior 30d (${w.prior.start}–${w.prior.end}) totals: total GMV, orders, videos posted, views, total creators who posted, new creators (first-ever post for this store), retention rate.\nOutput: {"A2":{"gmv":0,"orders":0,"videos":0,"views":0,"creators":0,"newCreators":0,"retention":0}}`
  },
  3: {
    label: 'Pulling creator tier breakdown…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Current 30d (${w.d30.start}–${w.d30.end}) by creator tier (tier based on global gmv_30d: G1 <$25K, G2 $25K–$100K, G3 >$100K): creators who posted, new creators, videos posted, store GMV.\nOutput: {"A3":{"g1":{"creators":0,"newCreators":0,"videos":0,"gmv":0},"g2":{"creators":0,"newCreators":0,"videos":0,"gmv":0},"g3":{"creators":0,"newCreators":0,"videos":0,"gmv":0}}}`
  },
  4: {
    label: 'Pulling current outreach data…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Current 30d (${w.d30.start}–${w.d30.end}) outreach totals + by tier (G1/G2/G3): messages sent, samples shipped.\nOutput: {"A4":{"total":{"msgs":0,"samples":0},"g1":{"msgs":0,"samples":0},"g2":{"msgs":0,"samples":0},"g3":{"msgs":0,"samples":0}}}`
  },
  5: {
    label: 'Pulling prior outreach data…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Prior 30d (${w.prior.start}–${w.prior.end}) outreach totals + by tier (G1/G2/G3): messages sent, samples shipped.\nOutput: {"A5":{"total":{"msgs":0,"samples":0},"g1":{"msgs":0,"samples":0},"g2":{"msgs":0,"samples":0},"g3":{"msgs":0,"samples":0}}}`
  },
  6: {
    label: 'Pulling GMV Max data…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: GMV Max current 30d (${w.d30.start}–${w.d30.end}): total ad spend, attributed revenue, blended ROI. Use 0 if data unavailable before May 14 2026.\nOutput: {"A6":{"spend":0,"revenue":0,"roi":0}}`
  },
  // live_refresh saves after phase 6
  7: {
    label: 'Pulling top 15 creators…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Top 15 creators by store GMV (${w.d30.start}–${w.d30.end}): handle, followers, store GMV, global gmv_30d, views, videos L30d, videos with any GMV L30d, lifetime videos for this store, videos L7d, orders, AOV, engagement rate.\nOutput: {"topCreators":[{"h":"","flw":0,"sgmv":0,"ggmv":0,"views":0,"v30":0,"vmgmv":0,"vlife":0,"v7":0,"ord":0,"aov":0,"eng":null}]}`
  },
  8: {
    label: 'Pulling top 15 videos…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Top 15 videos by store GMV (${w.d30.start}–${w.d30.end}): creator handle, product name (shorten: "Hard Bottom Backseat Extenders for Dogs with Door Protection"→"Back Seat Ext.", "XL Floor Cover for Full-Size Crew Cab Trucks with Fold Up Seats"→"XL Floor Cover", "Travel Dog Bed for Car"→"Travel Dog Bed"), GMV, views, orders, AOV, publish date, likes, comments, product clicks.\nOutput: {"topVideos":[{"h":"","ggmv":0,"prod":"","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":""}]}`
  },
  9: {
    label: 'Pulling most active creators…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Top 15 creators by videos posted (${w.d30.start}–${w.d30.end}): handle, global GMV, followers, videos posted, GMV from those videos (new video GMV), total store GMV, total views, avg views per video, orders.\nOutput: {"activeCreators":[{"h":"","ggmv":0,"flw":0,"v30":0,"gmvN":0,"gmvT":0,"views":0,"avgv":0,"ord":0}]}`
  },
  10: {
    label: 'Pulling 13-week GMV trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Weekly GMV + orders for all 13 Sun–Sat weeks in ${w.weeksRange}. Return 13 rows in chronological order.\nOutput (exactly 13 items): {"C1":[{"gmv":0,"orders":0}]}`
  },
  11: {
    label: 'Pulling 13-week creator trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Weekly creators, new creators, videos posted, store GMV by tier (G1/G2/G3) for all 13 weeks in ${w.weeksRange}. Return 13 rows per tier.\nOutput (exactly 13 items per array): {"C2":{"g1":[{"creators":0,"newCreators":0,"videos":0,"gmv":0}],"g2":[{"creators":0,"newCreators":0,"videos":0,"gmv":0}],"g3":[{"creators":0,"newCreators":0,"videos":0,"gmv":0}]}}`
  },
  12: {
    label: 'Pulling 13-week retention & video trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Weekly retention rate + total videos posted + total views for all 13 weeks in ${w.weeksRange}.\nOutput (exactly 13 items): {"C3":[0],"C4":[{"videos":0,"views":0}]}`
  },
  13: {
    label: 'Pulling 13-week outreach trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Weekly messages sent + samples shipped by tier (G1/G2/G3) for all 13 weeks in ${w.weeksRange}.\nOutput (exactly 13 items per array): {"C5":{"g1":[{"msgs":0,"samples":0}],"g2":[{"msgs":0,"samples":0}],"g3":[{"msgs":0,"samples":0}]}}`
  },
  14: {
    label: 'Pulling 6-month GMV trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Monthly GMV + views for each of the 6 months: ${w.monthKeys}. Return 6 rows chronological.\nOutput (exactly 6 items): {"D1":[{"gmv":0,"views":0}]}`
  },
  15: {
    label: 'Pulling 6-month creator trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Monthly creators, new creators, videos, store GMV by tier (G1/G2/G3) for months ${w.monthKeys}. Return 6 rows per tier.\nOutput (exactly 6 items per array): {"D2":{"g1":[{"creators":0,"newCreators":0,"videos":0,"gmv":0}],"g2":[{"creators":0,"newCreators":0,"videos":0,"gmv":0}],"g3":[{"creators":0,"newCreators":0,"videos":0,"gmv":0}]}}`
  },
  16: {
    label: 'Pulling 6-month retention & outreach…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Monthly retention rate + outreach (messages sent + samples shipped by tier G1/G2/G3) for months ${w.monthKeys}.\nOutput (exactly 6 items per array): {"D3":[0],"D4":{"g1":[{"msgs":0,"samples":0}],"g2":[{"msgs":0,"samples":0}],"g3":[{"msgs":0,"samples":0}]}}`
  },
  17: {
    label: 'Writing analysis…',
    mcp: false,
    prompt: (w, pd) => {
      const a1=pd.A1||{}, a2=pd.A2||{}
      const gmvChg = a2.gmv ? Math.round(((a1.gmv-a2.gmv)/a2.gmv)*100) : 0
      return `Senior analyst writing TikTok Shop affiliate report for the Ruff Liners CEO. Be direct, use real numbers.
DATA SUMMARY: GMV $${a1.gmv||0} (${gmvChg>0?'+':''}${gmvChg}% vs prior), Orders ${a1.orders||0}, Videos ${a1.videos||0}, Creators ${a1.creators||0}, New ${a1.newCreators||0}, Retention ${a1.retention||0}%
GMV Max: Spend $${pd.A6?.spend||0}, Revenue $${pd.A6?.revenue||0}, ROI ${pd.A6?.roi||0}x
FULL DATA: ${JSON.stringify(pd).slice(0,7000)}

Write 3 analyses:
1. d30 (4-5 paragraphs): headline GMV, tier drivers, creator health + retention, GMV Max efficiency, recruiting, 30d outlook
2. weekly (3 paragraphs): 13-week trend arc, creator/content patterns, recruiting lag
3. monthly (3 paragraphs): 6-month trajectory, tier mix shifts, strategic outlook

Output ONLY: {"d30":"para1\\n\\npara2\\n\\npara3\\n\\npara4\\n\\npara5","weekly":"para1\\n\\npara2\\n\\npara3","monthly":"para1\\n\\npara2\\n\\npara3"}`
    }
  },
  18: {
    label: 'Saving report…',
    mcp: false,
    prompt: () => '' // handled in code, not via claude
  }
}

const LIVE_SAVE_AFTER = 6  // live_refresh saves after phase 6 (A1-A6 complete)
const TOTAL_PHASES = 18

function assemble(w: ReturnType<typeof buildWindows>, pd: any, analysis: any) {
  const a1=pd.A1||{}, a2=pd.A2||{}, a3=pd.A3||{g1:{},g2:{},g3:{}}, a4=pd.A4||{total:{},g1:{},g2:{},g3:{}}, a5=pd.A5||{total:{},g1:{},g2:{},g3:{}}, a6=pd.A6||{}
  const pct=(c:number,p:number)=>p?Math.round(((c-p)/p)*100):0
  const delta=(c:number,p:number)=>Math.round((c-p)*10)/10
  const c1=pd.C1||[], c2=pd.C2||{g1:[],g2:[],g3:[]}, c3=pd.C3||[], c4=pd.C4||[], c5=pd.C5||{g1:[],g2:[],g3:[]}
  const d1=pd.D1||[], d2=pd.D2||{g1:[],g2:[],g3:[]}, d3=pd.D3||[], d4=pd.D4||{g1:[],g2:[],g3:[]}
  return {
    report_date:w.reportDate, label:w.label, data_window:w.dataWindow,
    d30:{
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

async function getAnthropicKey(): Promise<string|null> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try { const {data}=await supabaseAdmin().from('app_config').select('value').eq('key','anthropic_api_key').single(); return (data?.value as string)??null } catch { return null }
}

async function callClaude(prompt: string, apiKey: string, withMcp: boolean): Promise<string> {
  const body: any = { model: 'claude-sonnet-4-6', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }
  if (withMcp) {
    const raw = (process.env.EUKA_BEARER_TOKEN||'').trim()
    const tok = raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw
    const srv: any = { type: 'url', url: process.env.EUKA_MCP_URL!, name: 'euka' }
    if (tok) srv.authorization_token = tok
    body.mcp_servers = [srv]
  }
  // 740s timeout — leaves 60s buffer before Vercel Pro 800s limit
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'mcp-client-2025-04-04' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(740000)
    })
  } catch (e: any) {
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    throw new Error(isTimeout ? 'Anthropic API timed out after 740s' : `Anthropic API unreachable: ${e?.message}`)
  }
  if (!res.ok) { const t=await res.text(); throw new Error(`Claude API ${res.status}: ${t.slice(0,300)}`) }
  const data = await res.json()
  return (data.content||[]).filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n')
}

function extractJson(text: string): any {
  const s=text.indexOf('{'), e=text.lastIndexOf('}')
  if (s===-1||e===-1) throw new Error('No JSON in Claude response')
  return JSON.parse(text.slice(s,e+1))
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { jobId } = await req.json().catch(()=>({}))
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

  let supabase: ReturnType<typeof supabaseAdmin>
  try { supabase = supabaseAdmin() } catch (e: any) {
    return NextResponse.json({ error: `DB config error: ${e?.message}` }, { status: 503 })
  }

  const { data: job } = await supabase.from('report_jobs').select('*').eq('id', jobId).single()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  if (job.status === 'done') return NextResponse.json({ ok: true, nextPhase: null })
  if (job.status === 'error') return NextResponse.json({ ok: false, error: job.error }, { status: 500 })

  const apiKey = await getAnthropicKey()
  if (!apiKey) {
    await supabase.from('report_jobs').update({ status:'error', error:'Anthropic API key not configured', updated_at:new Date().toISOString() }).eq('id',jobId)
    return NextResponse.json({ error: 'API key not configured' }, { status: 503 })
  }

  const params = job.params || {}
  const today = params.today ? new Date(params.today) : new Date()
  const w = buildWindows(today)
  const isLive = job.job_type === 'live_refresh'
  const pd = { ...(job.phase_data||{}) }
  const nextPhase = (job.phase||0) + 1

  const upd = async (phase: number, label: string, extra?: any) =>
    supabase.from('report_jobs').update({ phase, phase_label:label, phase_data:pd, updated_at:new Date().toISOString(), ...extra }).eq('id',jobId)

  try {
    const phaseConfig = PHASES[nextPhase]
    if (!phaseConfig) {
      // past last phase — mark done
      await supabase.from('report_jobs').update({ status:'done', phase_label:'Complete ✓', updated_at:new Date().toISOString() }).eq('id',jobId)
      return NextResponse.json({ ok:true, nextPhase:null })
    }

    await upd(nextPhase, phaseConfig.label)

    if (nextPhase === 18) {
      // Save phase — phase 17 stores analysis keys at top level of pd
      const analysis = { d30: pd.d30||'', weekly: pd.weekly||'', monthly: pd.monthly||'' }
      const report = assemble(w, pd, analysis)
      await supabase.from('weekly_reports').upsert(report, { onConflict:'report_date' })
      await supabase.from('report_jobs').update({ status:'done', phase:18, phase_label:'Complete ✓', updated_at:new Date().toISOString() }).eq('id',jobId)
      return NextResponse.json({ ok:true, nextPhase:null })
    }

    const text = await callClaude(phaseConfig.prompt(w, pd), apiKey, phaseConfig.mcp)
    let parsed: any
    try {
      parsed = extractJson(text)
    } catch {
      const preview = text.slice(0, 600)
      console.error(`Phase ${nextPhase} non-JSON response:`, preview)
      throw new Error(`No JSON in Claude response (phase ${nextPhase}). Claude said: ${preview}`)
    }
    Object.assign(pd, parsed)
    await upd(nextPhase, `Phase ${nextPhase} done`)

    // live_refresh: save after collecting A1-A6 (phases 1-6)
    if (isLive && nextPhase === LIVE_SAVE_AFTER) {
      const report = assemble(w, pd, { d30:'', weekly:'', monthly:'' })
      await supabase.from('weekly_reports').upsert(report, { onConflict:'report_date' })
      await supabase.from('report_jobs').update({ status:'done', phase:nextPhase, phase_label:'Done ✓', updated_at:new Date().toISOString() }).eq('id',jobId)
      return NextResponse.json({ ok:true, nextPhase:null })
    }

    const next = nextPhase + 1
    return NextResponse.json({ ok:true, nextPhase: next > TOTAL_PHASES ? null : next })

  } catch (err: any) {
    const msg = err?.message||'Unknown error'
    console.error(`Job ${jobId} phase ${nextPhase}:`, msg)
    await supabase.from('report_jobs').update({ status:'error', error:msg.slice(0,500), updated_at:new Date().toISOString() }).eq('id',jobId)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
