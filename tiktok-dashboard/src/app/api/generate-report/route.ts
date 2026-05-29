import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  format, subDays, startOfMonth, endOfMonth, subMonths
} from 'date-fns'

async function getAnthropicKey(): Promise<string | null> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try {
    const sb = supabaseAdmin()
    const { data } = await sb.from('app_config').select('value').eq('key', 'anthropic_api_key').single()
    return (data?.value as string) ?? null
  } catch { return null }
}

export const maxDuration = 300
export const dynamic = 'force-dynamic'

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
    reportDate:  format(today, 'yyyy-MM-dd'),
    label:       format(today, 'MMMM d, yyyy'),
    dataWindow:  `${format(gmvStart, 'MMM d')} – ${format(gmvEnd, 'MMM d, yyyy')}`,
    d30:   { start: f(gmvStart),   end: f(gmvEnd) },
    prior: { start: f(priorStart), end: f(priorEnd) },
    last7: { start: f(last7Start), end: f(lastSat) },
    weeks,
    months,
    weekLabels:  weeks.map(w => `${w.start.getMonth() + 1}/${w.start.getDate()}`),
    monthLabels: months.map(m => m.label),
    weeksRange:  `${f(weeks[0].start)} to ${f(lastSat)}`,
    monthKeys:   months.map(m => m.key).join(', ')
  }
}

function buildPrompt(w: ReturnType<typeof buildWindows>): string {
  return `You are a data extraction and analysis agent for the Ruff Liners TikTok Shop weekly report.

STORE ID: ${process.env.EUKA_STORE_ID}

COMPUTED DATE WINDOWS — use these exactly, do not recompute:
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

═══════════════════════════════
PHASE 1 — RUN ALL DATA QUERIES
═══════════════════════════════

[A1] Current 30d totals: GMV, orders, videos, views, creators, new creators, retention vs prior
[A2] Prior 30d totals: same fields
[A3] Current 30d by tier (G1 <$25K, G2 $25K-$100K, G3 >$100K): creators, new creators, videos, GMV
[A4] Current 30d outreach by tier: messages sent, samples shipped + totals
[A5] Prior 30d outreach totals + by tier
[A6] GMV Max current 30d: ad spend, revenue, ROI
[B1] Top 15 creators by store GMV — handle, followers, store GMV, global gmv_30d, views, videos L30d, videos L7d, orders, AOV, engagement rate
[B2] For B1 handles: videos with any GMV L30d, lifetime videos ever
[B3] Top 15 videos by store GMV — creator, product, GMV, views, orders, AOV, publish date, likes, comments, product clicks
[B4] Top 15 creators by videos posted — GMV from new videos only, total GMV, views, avg views, orders
[C1] 13 weeks GMV + orders: ${w.weeksRange}
[C2] 13 weeks by tier: creators, new creators, videos, GMV (39 rows)
[C3] 13 weeks retention rate (13 rows)
[C4] 13 weeks total videos + views (13 rows)
[C5] 13 weeks outreach by tier: messages + samples (39 rows)
[D1] 6 months GMV + views: ${w.monthKeys}
[D2] 6 months by tier: creators, new creators, videos, GMV (18 rows)
[D3] 6 months retention rate (6 rows)
[D4] 6 months outreach by tier: messages + samples (18 rows)

═══════════════════════════════════════════════
PHASE 2 — WRITE ANALYSIS FOR EACH REPORT TAB
═══════════════════════════════════════════════

Write as a senior analyst briefing the CEO. Be direct, specific, use actual numbers.

d30 analysis (4-5 paragraphs): headline, GMV drivers by tier, creator health + retention, GMV Max ROI + spend efficiency, recruiting effectiveness, forward 30d projection
weekly analysis (3 paragraphs): 13-week arc narrative, creator/content patterns, recruiting lag correlations
monthly analysis (3 paragraphs): 6-month growth rate + trajectory, tier mix changes, strategic outlook

═══════════════════════════════════
PHASE 3 — OUTPUT THE COMPLETE JSON
═══════════════════════════════════

Output ONLY this JSON. No prose before or after.

{
  "meta": { "reportDate": "${w.reportDate}", "label": "${w.label}", "dataWindow": "${w.dataWindow}" },
  "d30": {
    "gmv":0,"gmvPct":0,"orders":0,"ordersPct":0,"videos":0,"videosPct":0,
    "views":0,"viewsPct":0,"creators":0,"creatorsPct":0,"newCreators":0,"newCreatorsPct":0,
    "retention":0,"retentionDelta":0,
    "gmvMax":{"spend":0,"revenue":0,"roi":0},
    "msgs":0,"msgsPct":0,"samples":0,"samplesPct":0,
    "tiers":{
      "g1":{"creators":0,"newCreators":0,"videos":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0},
      "g2":{"creators":0,"newCreators":0,"videos":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0},
      "g3":{"creators":0,"newCreators":0,"videos":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0}
    }
  },
  "weeklyCharts":{
    "labels":${JSON.stringify(w.weekLabels)},
    "gmv":[],"views":[],
    "crg1":[],"crg2":[],"crg3":[],
    "ncg1":[],"ncg2":[],"ncg3":[],
    "vg1":[],"vg2":[],"vg3":[],
    "gg1":[],"gg2":[],"gg3":[],
    "ret":[],"vid":[],
    "mg1":[],"mg2":[],"mg3":[],
    "sg1":[],"sg2":[],"sg3":[]
  },
  "monthlyCharts":{
    "labels":${JSON.stringify(w.monthLabels)},
    "gmv":[],"views":[],
    "crg1":[],"crg2":[],"crg3":[],
    "ncg1":[],"ncg2":[],"ncg3":[],
    "vg1":[],"vg2":[],"vg3":[],
    "gg1":[],"gg2":[],"gg3":[],
    "ret":[],
    "mg1":[],"mg2":[],"mg3":[],
    "sg1":[],"sg2":[],"sg3":[]
  },
  "tables":{
    "topCreators":[{"h":"","flw":0,"sgmv":0,"ggmv":0,"views":0,"v30":0,"vmgmv":0,"vlife":0,"v7":0,"ord":0,"aov":0,"eng":null,"active":true}],
    "topVideos":[{"h":"","ggmv":0,"prod":"","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":""}],
    "activeCreators":[{"h":"","ggmv":0,"flw":0,"v30":0,"gmvN":0,"gmvT":0,"views":0,"avgv":0,"ord":0}]
  },
  "analysis":{
    "d30":"4-5 paragraph analysis. Use \\n\\n between paragraphs.",
    "weekly":"3 paragraph analysis. Use \\n\\n between paragraphs.",
    "monthly":"3 paragraph analysis. Use \\n\\n between paragraphs."
  }
}

Product name shortening:
"Hard Bottom Backseat Extenders for Dogs with Door Protection" → "Back Seat Ext."
"XL Floor Cover for Full-Size Crew Cab Trucks with Fold Up Seats" → "XL Floor Cover"
"Travel Dog Bed for Car" → "Travel Dog Bed"
`
}

function extractJson(text: string): any {
  const start = text.indexOf('{')
  const end   = text.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON block found in response')
  return JSON.parse(text.slice(start, end + 1))
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const anthropicKey = await getAnthropicKey()
  if (!anthropicKey) {
    return NextResponse.json({ error: 'Anthropic API key is not configured. Add it in Admin → Auto-Generate, or set ANTHROPIC_API_KEY in your environment variables.' }, { status: 503 })
  }

  const body = await req.json().catch(() => ({}))
  const today = body.today ? new Date(body.today) : new Date()
  const windows = buildWindows(today)
  const systemPrompt = buildPrompt(windows)

  let apiRes: Response
  try {
    apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-04-04'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 16000,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `Run the full weekly report for Ruff Liners TikTok Shop. Today is ${format(today, 'MMMM d, yyyy')}. Use the date windows in the system prompt exactly. Complete all 3 phases: run all queries, write all 3 analyses, then output the complete JSON.`
        }],
        mcp_servers: [{
          type: 'url',
          url: process.env.EUKA_MCP_URL!,
          name: 'euka',
          ...(process.env.EUKA_BEARER_TOKEN ? { authorization_token: process.env.EUKA_BEARER_TOKEN.replace(/^Bearer\s+/i, '') } : {})
        }]
      })
    })
  } catch {
    return NextResponse.json({ error: 'Could not reach the AI service. Check ANTHROPIC_API_KEY.' }, { status: 502 })
  }

  if (!apiRes.ok) {
    const txt = await apiRes.text()
    console.error('Claude API error:', txt)
    return NextResponse.json({ error: 'AI service error — check server logs.' }, { status: 502 })
  }

  const claudeData = await apiRes.json()
  const text = (claudeData.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')

  if (!text) {
    return NextResponse.json({ error: 'No response from AI. Euka MCP may not be reachable.' }, { status: 502 })
  }

  let report: any
  try {
    report = extractJson(text)
  } catch {
    console.error('JSON parse failed. Response start:', text.slice(0, 400))
    return NextResponse.json({ error: 'Could not parse AI response. Try again.' }, { status: 422 })
  }

  if (!report?.meta?.reportDate || !report?.d30?.gmv) {
    return NextResponse.json({ error: 'Report data incomplete. Try again.' }, { status: 422 })
  }

  if (!report.analysis) report.analysis = { d30: '', weekly: '', monthly: '' }

  const supabase = supabaseAdmin()
  const { error: dbErr } = await supabase
    .from('weekly_reports')
    .upsert({
      report_date:    report.meta.reportDate,
      label:          report.meta.label,
      data_window:    report.meta.dataWindow,
      d30:            report.d30,
      weekly_charts:  report.weeklyCharts,
      monthly_charts: report.monthlyCharts,
      tables:         report.tables,
      analysis:       report.analysis
    }, { onConflict: 'report_date' })

  if (dbErr) {
    console.error('Supabase error:', dbErr)
    return NextResponse.json({ error: 'Database save failed.' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    reportDate: report.meta.reportDate,
    label:      report.meta.label,
    gmv:        report.d30.gmv
  })
}
