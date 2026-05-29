import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

// ── date window helpers ──────────────────────────────────────────────────────

function buildWindows(today: Date) {
  const gmvEnd    = subDays(today, 2)
  const gmvStart  = subDays(gmvEnd, 29)
  const priorEnd  = subDays(gmvStart, 1)
  const priorStart = subDays(priorEnd, 29)

  const dow = gmvEnd.getDay()
  const lastSat = dow === 6 ? gmvEnd : subDays(gmvEnd, dow + 1)
  const last7Start = subDays(lastSat, 6)

  const weeks = Array.from({ length: 13 }, (_, i) => {
    const wEnd   = subDays(lastSat, i * 7)
    const wStart = subDays(wEnd, 6)
    return { start: wStart, end: wEnd }
  }).reverse()

  const months = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(today, 5 - i)
    const isPartial = i === 5
    return {
      key: format(d, 'yyyy-MM'),
      label: format(d, 'MMM') + (isPartial ? '*' : ''),
      start: startOfMonth(d),
      end: isPartial ? gmvEnd : endOfMonth(d)
    }
  })

  const f = (d: Date) => format(d, 'yyyy-MM-dd')

  return {
    reportDate:   format(today, 'yyyy-MM-dd'),
    label:        format(today, 'MMMM d, yyyy'),
    dataWindow:   `${format(gmvStart, 'MMM d')} – ${format(gmvEnd, 'MMM d, yyyy')}`,
    d30:   { start: f(gmvStart),   end: f(gmvEnd) },
    prior: { start: f(priorStart), end: f(priorEnd) },
    last7: { start: f(last7Start), end: f(lastSat) },
    weeks,
    months,
    weekLabels:   weeks.map(w => `${w.start.getMonth() + 1}/${w.start.getDate()}`),
    monthLabels:  months.map(m => m.label),
    weeksRange:   `${f(weeks[0].start)} to ${f(lastSat)}`,
    monthKeys:    months.map(m => m.key).join(', ')
  }
}

// ── phase prompts ────────────────────────────────────────────────────────────

const HEADER = (w: ReturnType<typeof buildWindows>) => `You are a data extraction agent for the Ruff Liners TikTok Shop report.

STORE ID: ${process.env.EUKA_STORE_ID}

DATE WINDOWS — use exactly, do not recompute:
  Current 30d:  ${w.d30.start} to ${w.d30.end}
  Prior 30d:    ${w.prior.start} to ${w.prior.end}
  Last 7d:      ${w.last7.start} to ${w.last7.end}
  13 weeks:     ${w.weeksRange} (Sun–Sat)
  6 months:     ${w.monthKeys}

RULES:
- Always specify year 2026 in queries
- Read every sandbox CSV with read_sandbox_file — never rely on summaries
- Use creator_store_performance table for GMV (not video-level sums)
- New creators = first-ever video for this store
- If a query returns 0 rows, retry explicitly stating 2026
- GMV Max data only available from May 14 2026 — use 0 if earlier

`

function phase1Prompt(w: ReturnType<typeof buildWindows>) {
  return HEADER(w) + `Run these 6 queries and output a JSON object with the results:

[A1] Current 30d totals: GMV, orders, videos, views, total creators, new creators (first-ever video for this store), retention rate
[A2] Prior 30d totals: same 7 fields
[A3] Current 30d by tier (G1 global gmv_30d <$25K, G2 $25K–$100K, G3 >$100K): creators, new creators, videos posted, store GMV
[A4] Current 30d outreach by tier: messages sent, samples shipped + totals
[A5] Prior 30d outreach by tier: messages sent, samples shipped + totals
[A6] GMV Max current 30d: ad spend, revenue, ROI (0 if unavailable)

Output ONLY this JSON — no prose:
{
  "A1": {"gmv":0,"orders":0,"videos":0,"views":0,"creators":0,"newCreators":0,"retention":0},
  "A2": {"gmv":0,"orders":0,"videos":0,"views":0,"creators":0,"newCreators":0,"retention":0},
  "A3": {
    "g1":{"creators":0,"newCreators":0,"videos":0,"gmv":0},
    "g2":{"creators":0,"newCreators":0,"videos":0,"gmv":0},
    "g3":{"creators":0,"newCreators":0,"videos":0,"gmv":0}
  },
  "A4": {
    "total":{"msgs":0,"samples":0},
    "g1":{"msgs":0,"samples":0},
    "g2":{"msgs":0,"samples":0},
    "g3":{"msgs":0,"samples":0}
  },
  "A5": {
    "total":{"msgs":0,"samples":0},
    "g1":{"msgs":0,"samples":0},
    "g2":{"msgs":0,"samples":0},
    "g3":{"msgs":0,"samples":0}
  },
  "A6": {"spend":0,"revenue":0,"roi":0}
}`
}

function phase2Prompt(w: ReturnType<typeof buildWindows>) {
  return HEADER(w) + `Run these 4 queries and output a JSON object with the results:

[B1] Top 15 creators by store GMV — handle, followers, store GMV, global gmv_30d, views, videos L30d, videos L7d, orders, AOV, engagement rate
[B2] For each B1 handle: count of videos with any store GMV in the 30d window; count of lifetime total videos for this store
[B3] Top 15 videos by store GMV — creator handle, product name (shorten: "Hard Bottom Backseat Extenders for Dogs with Door Protection"→"Back Seat Ext.", "XL Floor Cover for Full-Size Crew Cab Trucks with Fold Up Seats"→"XL Floor Cover", "Travel Dog Bed for Car"→"Travel Dog Bed"), GMV, views, orders, AOV, publish date, likes, comments, product clicks
[B4] Top 15 creators by videos posted L30d — handle, global GMV, followers, videos posted, GMV from those videos (new GMV), total store GMV, views, avg views, orders

Output ONLY this JSON — no prose:
{
  "topCreators": [{"h":"","flw":0,"sgmv":0,"ggmv":0,"views":0,"v30":0,"vmgmv":0,"vlife":0,"v7":0,"ord":0,"aov":0,"eng":null}],
  "topVideos": [{"h":"","ggmv":0,"prod":"","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":""}],
  "activeCreators": [{"h":"","ggmv":0,"flw":0,"v30":0,"gmvN":0,"gmvT":0,"views":0,"avgv":0,"ord":0}]
}`
}

function phase3Prompt(w: ReturnType<typeof buildWindows>) {
  return HEADER(w) + `Run these 5 queries and output a JSON object with the results:

[C1] 13 weeks GMV + orders for ${w.weeksRange} — 13 rows, one per week in chronological order
[C2] 13 weeks by tier (G1/G2/G3): creators, new creators, videos, store GMV — 39 rows total
[C3] 13 weeks retention rate — 13 rows
[C4] 13 weeks total videos posted + total views — 13 rows
[C5] 13 weeks outreach by tier: messages + samples — 39 rows

Output ONLY this JSON. Arrays must have exactly 13 items each (or 39 for tier arrays). No prose:
{
  "C1": [{"gmv":0,"orders":0}],
  "C2": {
    "g1":[{"creators":0,"newCreators":0,"videos":0,"gmv":0}],
    "g2":[{"creators":0,"newCreators":0,"videos":0,"gmv":0}],
    "g3":[{"creators":0,"newCreators":0,"videos":0,"gmv":0}]
  },
  "C3": [0],
  "C4": [{"videos":0,"views":0}],
  "C5": {
    "g1":[{"msgs":0,"samples":0}],
    "g2":[{"msgs":0,"samples":0}],
    "g3":[{"msgs":0,"samples":0}]
  }
}`
}

function phase4Prompt(w: ReturnType<typeof buildWindows>) {
  return HEADER(w) + `Run these 4 queries and output a JSON object with the results:

[D1] 6 months GMV + views for ${w.monthKeys} — 6 rows chronological
[D2] 6 months by tier (G1/G2/G3): creators, new creators, videos, store GMV — 18 rows
[D3] 6 months retention rate — 6 rows
[D4] 6 months outreach by tier: messages + samples — 18 rows

Output ONLY this JSON. Arrays must have exactly 6 items each. No prose:
{
  "D1": [{"gmv":0,"views":0}],
  "D2": {
    "g1":[{"creators":0,"newCreators":0,"videos":0,"gmv":0}],
    "g2":[{"creators":0,"newCreators":0,"videos":0,"gmv":0}],
    "g3":[{"creators":0,"newCreators":0,"videos":0,"gmv":0}]
  },
  "D3": [0],
  "D4": {
    "g1":[{"msgs":0,"samples":0}],
    "g2":[{"msgs":0,"samples":0}],
    "g3":[{"msgs":0,"samples":0}]
  }
}`
}

function phase5Prompt(w: ReturnType<typeof buildWindows>, accData: any) {
  const a1 = accData.A1 || {}
  const a2 = accData.A2 || {}
  const gmvPct  = a2.gmv  ? Math.round(((a1.gmv  - a2.gmv)  / a2.gmv)  * 100) : 0
  const ordPct  = a2.orders ? Math.round(((a1.orders - a2.orders) / a2.orders) * 100) : 0

  return `You are a senior analyst writing a TikTok Shop affiliate report for the Ruff Liners CEO.

DATA SUMMARY (from previous queries):
- Current 30d: GMV $${a1.gmv?.toLocaleString() || 0}, Orders ${a1.orders || 0}, Videos ${a1.videos || 0}, Creators ${a1.creators || 0}, New creators ${a1.newCreators || 0}, Retention ${a1.retention || 0}%
- Prior 30d: GMV $${a2.gmv?.toLocaleString() || 0}, Orders ${a2.orders || 0}
- Change: GMV ${gmvPct > 0 ? '+' : ''}${gmvPct}%, Orders ${ordPct > 0 ? '+' : ''}${ordPct}%
- GMV Max: Spend $${accData.A6?.spend?.toLocaleString() || 0}, Revenue $${accData.A6?.revenue?.toLocaleString() || 0}, ROI ${accData.A6?.roi || 0}x

Full data: ${JSON.stringify(accData).slice(0, 8000)}

Write 3 analyses:
1. d30 (4-5 paragraphs): headline performance, GMV drivers by tier, creator health + retention, GMV Max ROI efficiency, recruiting effectiveness, forward 30d projection
2. weekly (3 paragraphs): 13-week trend arc narrative, creator/content patterns, recruiting lag
3. monthly (3 paragraphs): 6-month growth trajectory, tier mix evolution, strategic outlook

Output ONLY this JSON:
{
  "d30": "paragraph 1\\n\\nparagraph 2\\n\\nparagraph 3\\n\\nparagraph 4\\n\\nparagraph 5",
  "weekly": "paragraph 1\\n\\nparagraph 2\\n\\nparagraph 3",
  "monthly": "paragraph 1\\n\\nparagraph 2\\n\\nparagraph 3"
}`
}

// ── claude caller ────────────────────────────────────────────────────────────

async function callClaude(systemPrompt: string, userMsg: string, apiKey: string, withMcp: boolean): Promise<string> {
  const rawToken = (process.env.EUKA_AUTH_TOKEN || '').trim()
  const eukaToken = rawToken.startsWith('Bearer ') ? rawToken.slice(7).trim() : rawToken

  const body: any = {
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMsg }]
  }

  if (withMcp) {
    body.mcp_servers = [{
      type: 'url',
      url: process.env.EUKA_MCP_URL!,
      name: 'euka',
      authorization_token: eukaToken
    }]
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'mcp-client-2025-04-04'
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Claude API error ${res.status}: ${txt.slice(0, 200)}`)
  }

  const data = await res.json()
  return (data.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
}

function extractJson(text: string): any {
  const start = text.indexOf('{')
  const end   = text.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON in response')
  return JSON.parse(text.slice(start, end + 1))
}

async function getAnthropicKey(): Promise<string | null> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try {
    const sb = supabaseAdmin()
    const { data } = await sb.from('app_config').select('value').eq('key', 'anthropic_api_key').single()
    return (data?.value as string) ?? null
  } catch { return null }
}

// ── assemble final report from accumulated phase_data ────────────────────────

function assembleFinalReport(w: ReturnType<typeof buildWindows>, pd: any, analysis: any) {
  const a1 = pd.A1 || {}
  const a2 = pd.A2 || {}
  const a3 = pd.A3 || { g1: {}, g2: {}, g3: {} }
  const a4 = pd.A4 || { total: {}, g1: {}, g2: {}, g3: {} }
  const a5 = pd.A5 || { total: {}, g1: {}, g2: {}, g3: {} }
  const a6 = pd.A6 || { spend: 0, revenue: 0, roi: 0 }

  const pct = (cur: number, pri: number) => pri ? Math.round(((cur - pri) / pri) * 100) : 0
  const delta = (cur: number, pri: number) => Math.round((cur - pri) * 10) / 10

  const msgsCur  = a4.total?.msgs    || 0
  const msgsPri  = a5.total?.msgs    || 0
  const smpCur   = a4.total?.samples || 0
  const smpPri   = a5.total?.samples || 0

  const c1 = pd.C1 || []
  const c2 = pd.C2 || { g1: [], g2: [], g3: [] }
  const c3 = pd.C3 || []
  const c4 = pd.C4 || []
  const c5 = pd.C5 || { g1: [], g2: [], g3: [] }
  const d1 = pd.D1 || []
  const d2 = pd.D2 || { g1: [], g2: [], g3: [] }
  const d3 = pd.D3 || []
  const d4 = pd.D4 || { g1: [], g2: [], g3: [] }

  return {
    report_date:   w.reportDate,
    label:         w.label,
    data_window:   w.dataWindow,
    d30: {
      gmv:          a1.gmv    || 0,
      gmvPct:       pct(a1.gmv    || 0, a2.gmv    || 0),
      orders:       a1.orders || 0,
      ordersPct:    pct(a1.orders || 0, a2.orders || 0),
      videos:       a1.videos || 0,
      videosPct:    pct(a1.videos || 0, a2.videos || 0),
      views:        a1.views  || 0,
      viewsPct:     pct(a1.views  || 0, a2.views  || 0),
      creators:     a1.creators    || 0,
      creatorsPct:  pct(a1.creators    || 0, a2.creators    || 0),
      newCreators:  a1.newCreators || 0,
      newCreatorsPct: pct(a1.newCreators || 0, a2.newCreators || 0),
      retention:    a1.retention   || 0,
      retentionDelta: delta(a1.retention || 0, a2.retention || 0),
      gmvMax: { spend: a6.spend || 0, revenue: a6.revenue || 0, roi: a6.roi || 0 },
      msgs:     msgsCur,
      msgsPct:  pct(msgsCur, msgsPri),
      samples:  smpCur,
      samplesPct: pct(smpCur, smpPri),
      tiers: {
        g1: {
          creators:    a3.g1?.creators    || 0,
          newCreators: a3.g1?.newCreators || 0,
          videos:      a3.g1?.videos      || 0,
          gmv:         a3.g1?.gmv         || 0,
          msgs:        a4.g1?.msgs        || 0,
          msgsPct:     pct(a4.g1?.msgs || 0, a5.g1?.msgs || 0),
          samples:     a4.g1?.samples     || 0,
          samplesPct:  pct(a4.g1?.samples || 0, a5.g1?.samples || 0)
        },
        g2: {
          creators:    a3.g2?.creators    || 0,
          newCreators: a3.g2?.newCreators || 0,
          videos:      a3.g2?.videos      || 0,
          gmv:         a3.g2?.gmv         || 0,
          msgs:        a4.g2?.msgs        || 0,
          msgsPct:     pct(a4.g2?.msgs || 0, a5.g2?.msgs || 0),
          samples:     a4.g2?.samples     || 0,
          samplesPct:  pct(a4.g2?.samples || 0, a5.g2?.samples || 0)
        },
        g3: {
          creators:    a3.g3?.creators    || 0,
          newCreators: a3.g3?.newCreators || 0,
          videos:      a3.g3?.videos      || 0,
          gmv:         a3.g3?.gmv         || 0,
          msgs:        a4.g3?.msgs        || 0,
          msgsPct:     pct(a4.g3?.msgs || 0, a5.g3?.msgs || 0),
          samples:     a4.g3?.samples     || 0,
          samplesPct:  pct(a4.g3?.samples || 0, a5.g3?.samples || 0)
        }
      }
    },
    weekly_charts: {
      labels: w.weekLabels,
      gmv:    c1.map((r: any) => r.gmv    || 0),
      views:  c4.map((r: any) => r.views  || 0),
      crg1:   c2.g1?.map((r: any) => r.creators    || 0) || [],
      crg2:   c2.g2?.map((r: any) => r.creators    || 0) || [],
      crg3:   c2.g3?.map((r: any) => r.creators    || 0) || [],
      ncg1:   c2.g1?.map((r: any) => r.newCreators || 0) || [],
      ncg2:   c2.g2?.map((r: any) => r.newCreators || 0) || [],
      ncg3:   c2.g3?.map((r: any) => r.newCreators || 0) || [],
      vg1:    c2.g1?.map((r: any) => r.videos      || 0) || [],
      vg2:    c2.g2?.map((r: any) => r.videos      || 0) || [],
      vg3:    c2.g3?.map((r: any) => r.videos      || 0) || [],
      gg1:    c2.g1?.map((r: any) => r.gmv         || 0) || [],
      gg2:    c2.g2?.map((r: any) => r.gmv         || 0) || [],
      gg3:    c2.g3?.map((r: any) => r.gmv         || 0) || [],
      ret:    c3.map((r: any) => typeof r === 'number' ? r : 0),
      vid:    c4.map((r: any) => r.videos || 0),
      mg1:    c5.g1?.map((r: any) => r.msgs    || 0) || [],
      mg2:    c5.g2?.map((r: any) => r.msgs    || 0) || [],
      mg3:    c5.g3?.map((r: any) => r.msgs    || 0) || [],
      sg1:    c5.g1?.map((r: any) => r.samples || 0) || [],
      sg2:    c5.g2?.map((r: any) => r.samples || 0) || [],
      sg3:    c5.g3?.map((r: any) => r.samples || 0) || []
    },
    monthly_charts: {
      labels: w.monthLabels,
      gmv:    d1.map((r: any) => r.gmv    || 0),
      views:  d1.map((r: any) => r.views  || 0),
      crg1:   d2.g1?.map((r: any) => r.creators    || 0) || [],
      crg2:   d2.g2?.map((r: any) => r.creators    || 0) || [],
      crg3:   d2.g3?.map((r: any) => r.creators    || 0) || [],
      ncg1:   d2.g1?.map((r: any) => r.newCreators || 0) || [],
      ncg2:   d2.g2?.map((r: any) => r.newCreators || 0) || [],
      ncg3:   d2.g3?.map((r: any) => r.newCreators || 0) || [],
      vg1:    d2.g1?.map((r: any) => r.videos      || 0) || [],
      vg2:    d2.g2?.map((r: any) => r.videos      || 0) || [],
      vg3:    d2.g3?.map((r: any) => r.videos      || 0) || [],
      gg1:    d2.g1?.map((r: any) => r.gmv         || 0) || [],
      gg2:    d2.g2?.map((r: any) => r.gmv         || 0) || [],
      gg3:    d2.g3?.map((r: any) => r.gmv         || 0) || [],
      ret:    d3.map((r: any) => typeof r === 'number' ? r : 0),
      mg1:    d4.g1?.map((r: any) => r.msgs    || 0) || [],
      mg2:    d4.g2?.map((r: any) => r.msgs    || 0) || [],
      mg3:    d4.g3?.map((r: any) => r.msgs    || 0) || [],
      sg1:    d4.g1?.map((r: any) => r.samples || 0) || [],
      sg2:    d4.g2?.map((r: any) => r.samples || 0) || [],
      sg3:    d4.g3?.map((r: any) => r.samples || 0) || []
    },
    tables: {
      topCreators:    pd.topCreators    || [],
      topVideos:      pd.topVideos      || [],
      activeCreators: pd.activeCreators || []
    },
    analysis: {
      d30:     analysis.d30     || '',
      weekly:  analysis.weekly  || '',
      monthly: analysis.monthly || ''
    }
  }
}

// ── main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { jobId } = body
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

  const supabase = supabaseAdmin()

  // load job
  const { data: job, error: jobErr } = await supabase
    .from('report_jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (jobErr || !job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  if (job.status === 'done') return NextResponse.json({ ok: true, status: 'done' })
  if (job.status === 'error') return NextResponse.json({ ok: false, status: 'error', error: job.error })

  // claim job
  await supabase.from('report_jobs').update({ status: 'running', updated_at: new Date().toISOString() }).eq('id', jobId)

  const apiKey = await getAnthropicKey()
  if (!apiKey) {
    await supabase.from('report_jobs').update({ status: 'error', error: 'Anthropic API key not configured', updated_at: new Date().toISOString() }).eq('id', jobId)
    return NextResponse.json({ error: 'API key not configured' }, { status: 503 })
  }

  const params     = job.params || {}
  const today      = params.today ? new Date(params.today) : new Date()
  const w          = buildWindows(today)
  const isLive     = job.job_type === 'live_refresh'
  const phaseData  = { ...(job.phase_data || {}) }

  const updateJob = async (phase: number, label: string, extra?: any) => {
    await supabase.from('report_jobs').update({
      phase,
      phase_label: label,
      phase_data: phaseData,
      updated_at: new Date().toISOString(),
      ...extra
    }).eq('id', jobId)
  }

  try {
    const nextPhase = (job.phase || 0) + 1

    if (nextPhase === 1) {
      // Phase 1: A1-A6 (KPIs + outreach + GMV Max)
      await updateJob(1, 'Pulling 30-day KPIs…')
      const text = await callClaude(phase1Prompt(w), 'Run all 6 queries and output the JSON.', apiKey, true)
      const result = extractJson(text)
      Object.assign(phaseData, result)
      await updateJob(1, 'Phase 1 complete')

      if (isLive) {
        // Live refresh only needs phase 1 — assemble partial report and save
        await updateJob(2, 'Saving live data…')
        const report = assembleFinalReport(w, phaseData, { d30: '', weekly: '', monthly: '' })
        await supabase.from('weekly_reports').upsert(report, { onConflict: 'report_date' })
        await supabase.from('report_jobs').update({ status: 'done', phase: 6, phase_label: 'Done', updated_at: new Date().toISOString() }).eq('id', jobId)
        return NextResponse.json({ ok: true, nextPhase: null })
      }

      return NextResponse.json({ ok: true, nextPhase: 2 })

    } else if (nextPhase === 2) {
      // Phase 2: B1-B4 (top creators + videos)
      await updateJob(2, 'Pulling top creators & videos…')
      const text = await callClaude(phase2Prompt(w), 'Run all 4 queries and output the JSON.', apiKey, true)
      const result = extractJson(text)
      Object.assign(phaseData, result)
      await updateJob(2, 'Phase 2 complete')
      return NextResponse.json({ ok: true, nextPhase: 3 })

    } else if (nextPhase === 3) {
      // Phase 3: C1-C5 (13-week trends)
      await updateJob(3, 'Pulling 13-week trends…')
      const text = await callClaude(phase3Prompt(w), 'Run all 5 queries and output the JSON.', apiKey, true)
      const result = extractJson(text)
      Object.assign(phaseData, result)
      await updateJob(3, 'Phase 3 complete')
      return NextResponse.json({ ok: true, nextPhase: 4 })

    } else if (nextPhase === 4) {
      // Phase 4: D1-D4 (6-month trends)
      await updateJob(4, 'Pulling 6-month data…')
      const text = await callClaude(phase4Prompt(w), 'Run all 4 queries and output the JSON.', apiKey, true)
      const result = extractJson(text)
      Object.assign(phaseData, result)
      await updateJob(4, 'Phase 4 complete')
      return NextResponse.json({ ok: true, nextPhase: 5 })

    } else if (nextPhase === 5) {
      // Phase 5: Analysis (no MCP)
      await updateJob(5, 'Writing analysis…')
      const text = await callClaude('', phase5Prompt(w, phaseData), apiKey, false)
      const analysis = extractJson(text)
      Object.assign(phaseData, { analysis })
      await updateJob(5, 'Phase 5 complete')
      return NextResponse.json({ ok: true, nextPhase: 6 })

    } else if (nextPhase === 6) {
      // Phase 6: Save to DB
      await updateJob(6, 'Saving to dashboard…')
      const report = assembleFinalReport(w, phaseData, phaseData.analysis || {})
      await supabase.from('weekly_reports').upsert(report, { onConflict: 'report_date' })
      await supabase.from('report_jobs').update({ status: 'done', phase: 6, phase_label: 'Complete ✓', updated_at: new Date().toISOString() }).eq('id', jobId)
      return NextResponse.json({ ok: true, nextPhase: null })

    } else {
      // Already done
      await supabase.from('report_jobs').update({ status: 'done', phase_label: 'Complete ✓', updated_at: new Date().toISOString() }).eq('id', jobId)
      return NextResponse.json({ ok: true, nextPhase: null })
    }

  } catch (err: any) {
    const msg = err?.message || 'Unknown error'
    console.error(`Job ${jobId} phase error:`, msg)
    await supabase.from('report_jobs').update({
      status: 'error',
      error: msg.slice(0, 500),
      updated_at: new Date().toISOString()
    }).eq('id', jobId)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
