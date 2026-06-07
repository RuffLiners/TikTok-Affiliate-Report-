import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { subDays, format, startOfMonth, endOfMonth, subMonths } from 'date-fns'

export const dynamic = 'force-dynamic'

function buildWindows(today: Date) {
  const gmvEnd = subDays(today, 2), gmvStart = subDays(gmvEnd, 29)
  const priorEnd = subDays(gmvStart, 1), priorStart = subDays(priorEnd, 29)
  const f = (d: Date) => format(d, 'yyyy-MM-dd')
  return {
    reportDate: format(today, 'yyyy-MM-dd'),
    label: format(today, 'MMMM d, yyyy'),
    dataWindow: `${format(gmvStart, 'MMM d')} – ${format(gmvEnd, 'MMM d, yyyy')}`,
    d30: { start: f(gmvStart), end: f(gmvEnd) },
    prior: { start: f(priorStart), end: f(priorEnd) },
  }
}

// POST — accept assembled d30 JSON (same schema as weekly report), merge into report
export async function POST(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { phaseData, reportDate, agentsOnly } = body

  let supabase: ReturnType<typeof supabaseAdmin>
  try { supabase = supabaseAdmin() } catch (e: any) {
    return NextResponse.json({ error: `DB config error: ${e?.message}` }, { status: 503 })
  }

  // Agents-only save: merge into existing live_report
  if (agentsOnly) {
    if (!Array.isArray(phaseData)) return NextResponse.json({ error: 'Expected JSON array for agents' }, { status: 400 })
    const { data: existing } = await supabase.from('app_config').select('value').eq('key', 'live_report').maybeSingle()
    const current = existing ? (() => { try { return JSON.parse(existing.value) } catch { return {} } })() : {}
    const merged = { ...current, agents: phaseData }
    const { error } = await supabase.from('app_config').upsert({ key: 'live_report', value: JSON.stringify(merged) }, { onConflict: 'key' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    revalidatePath('/dashboard')
    return NextResponse.json({ ok: true, agentCount: phaseData.length })
  }

  // Support both old A1-based format and new direct d30 format
  const isOldFormat = phaseData?.A1 !== undefined
  const isNewFormat = phaseData?.d30 !== undefined

  if (!isOldFormat && !isNewFormat) {
    return NextResponse.json({ error: 'Missing d30 data. Make sure you pasted the full JSON response.' }, { status: 400 })
  }

  const today = reportDate ? new Date(reportDate + 'T12:00:00') : new Date()
  const w = buildWindows(today)

  let d30: any, tables: any, agents: any[]

  if (isNewFormat) {
    // New format: Claude outputs assembled d30 directly (same as weekly report)
    d30 = {
      ...phaseData.d30,
      gmvMaxByAge: (Array.isArray(phaseData.d30?.gmvMaxByAge) && phaseData.d30.gmvMaxByAge.length > 0)
        ? phaseData.d30.gmvMaxByAge
        : undefined,
    }
    tables = phaseData.tables || { topCreators: [], topVideos: [], activeCreators: [] }
    agents = Array.isArray(phaseData.agents) ? phaseData.agents : []
  } else {
    // Legacy A1-A6 format
    const a1 = phaseData.A1 || {}, a2 = phaseData.A2 || {}
    const a3 = phaseData.A3 || { g1: {}, g2: {}, g3: {} }
    const a4 = phaseData.A4 || { total: {}, g1: {}, g2: {}, g3: {} }
    const a5 = phaseData.A5 || { total: {}, g1: {}, g2: {}, g3: {} }
    const a6 = phaseData.A6 || {}
    const pct = (c: number, p: number) => p ? Math.round(((c - p) / p) * 100) : 0
    const delta = (c: number, p: number) => Math.round((c - p) * 10) / 10
    d30 = {
      gmv: a1.gmv||0, gmvPct: pct(a1.gmv||0, a2.gmv||0),
      orders: a1.orders||0, ordersPct: pct(a1.orders||0, a2.orders||0),
      videos: a1.videos||0, videosPct: pct(a1.videos||0, a2.videos||0),
      views: a1.views||0, viewsPct: pct(a1.views||0, a2.views||0),
      creators: a1.creators||0, creatorsPct: pct(a1.creators||0, a2.creators||0),
      newCreators: a1.newCreators||0, newCreatorsPct: pct(a1.newCreators||0, a2.newCreators||0),
      retention: a1.retention||0, retentionDelta: delta(a1.retention||0, a2.retention||0),
      gmvMax: { spend: a6.spend||0, revenue: a6.revenue||0, roi: a6.roi||0 },
      msgs: a4.total?.msgs||0, msgsPct: pct(a4.total?.msgs||0, a5.total?.msgs||0),
      samples: a4.total?.samples||0, samplesPct: pct(a4.total?.samples||0, a5.total?.samples||0),
      tiers: {
        g1: { creators: a3.g1?.creators||0, newCreators: a3.g1?.newCreators||0, videos: a3.g1?.videos||0, gmv: a3.g1?.gmv||0, msgs: a4.g1?.msgs||0, msgsPct: pct(a4.g1?.msgs||0,a5.g1?.msgs||0), samples: a4.g1?.samples||0, samplesPct: pct(a4.g1?.samples||0,a5.g1?.samples||0) },
        g2: { creators: a3.g2?.creators||0, newCreators: a3.g2?.newCreators||0, videos: a3.g2?.videos||0, gmv: a3.g2?.gmv||0, msgs: a4.g2?.msgs||0, msgsPct: pct(a4.g2?.msgs||0,a5.g2?.msgs||0), samples: a4.g2?.samples||0, samplesPct: pct(a4.g2?.samples||0,a5.g2?.samples||0) },
        g3: { creators: a3.g3?.creators||0, newCreators: a3.g3?.newCreators||0, videos: a3.g3?.videos||0, gmv: a3.g3?.gmv||0, msgs: a4.g3?.msgs||0, msgsPct: pct(a4.g3?.msgs||0,a5.g3?.msgs||0), samples: a4.g3?.samples||0, samplesPct: pct(a4.g3?.samples||0,a5.g3?.samples||0) },
      }
    }
    tables = { topCreators: phaseData.topCreators||[], topVideos: phaseData.topVideos||[], activeCreators: phaseData.activeCreators||[] }
    agents = Array.isArray(phaseData.agents) ? phaseData.agents : []
  }

  // Save to app_config key 'live_report' — never touches weekly_reports
  const liveData = {
    report_date: w.reportDate,
    label: w.label,
    data_window: w.dataWindow,
    d30,
    tables,
    agents,
    analysis: { d30: '' },
  }
  const { error } = await supabase
    .from('app_config')
    .upsert({ key: 'live_report', value: JSON.stringify(liveData) }, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidatePath('/dashboard')
  return NextResponse.json({ ok: true, reportDate: w.reportDate, gmv: d30.gmv })
}

// GET — return Claude prompt using the same structure as the weekly report prompt
export async function GET(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const reportDate = searchParams.get('reportDate')
  const today = reportDate ? new Date(reportDate + 'T12:00:00') : new Date()
  const w = buildWindows(today)

  const storeId = process.env.EUKA_STORE_ID ?? ''

  const prompt = `Run the Ruff Liners TikTok Shop live 30-day report for today ${w.label}.

Store ID: ${storeId}

DATE WINDOWS — use these exactly:
- Current 30d: ${w.d30.start} to ${w.d30.end}
- Prior 30d: ${w.prior.start} to ${w.prior.end}

RULES: Always specify year 2026 in queries. Read every CSV with read_sandbox_file. Use creator_store_performance for GMV. New creators = first-ever video for this store. GMV Max only from May 14 2026 (use 0 if earlier).

PART A — KPI & TABLE QUERIES:
1. Current 30d totals: GMV, orders, videos posted, views, creators posted, new creators, retention rate
2. Prior 30d: same totals for % change calculations
3. Current 30d by creator tier (G1 = global gmv_30d <$25K, G2 = $25K–$100K, G3 = >$100K): creators, new creators, videos, views, store GMV
4. Current 30d outreach by tier: messages sent + samples shipped + overall totals
5. Prior 30d outreach: totals + by tier
6. GMV Max current 30d: total ad spend, attributed revenue, blended ROI (use 0 if before May 14 2026). Also break down spend by content age — buckets based on video publish date vs ${w.d30.end}: "< 30 days" (posted ${w.d30.start}–${w.d30.end}), "1–2 months" (31–60 days before ${w.d30.end}), "2–3 months" (61–90 days), "3–5 months" (91–150 days), "5+ months" (151+ days). For each non-empty bucket include: label, videos (count), spend, revenue, roi (revenue/spend, 0 if no spend), pct (spend as % of total spend).
7. Top 15 creators by store GMV — handle, followers, store GMV, global gmv_30d, views, videos L30d, videos w/GMV L30d, lifetime videos, videos L7d, orders, AOV, engagement rate
8. Top 15 videos by store GMV — creator handle, product name, GMV, views, orders, AOV, publish date, likes, comments, product clicks
9. Top 15 creators by videos posted — handle, followers, GMV from new-period videos only, total store GMV, views, avg views/video, orders

Product name shortening: "Hard Bottom Backseat Extenders for Dogs with Door Protection" → "Back Seat Ext." · "XL Floor Cover for Full-Size Crew Cab Trucks with Fold Up Seats" → "XL Floor Cover" · "Travel Dog Bed for Car" → "Travel Dog Bed"

PART B — OUTREACH & CRM AGENTS:
List all outreach and CRM agents created since ${w.d30.start}.
- Call list_outreach_agents with botStatus=["running","stopped","error"], limit=25, archived=false, storeId=${storeId}
- Run for agentType="outreach" with searchQuery: "", "G1", "G2", "G3", "Video Volume", "GMV Contest", "New Agent"
- Run for agentType="crm" with searchQuery: "", "G1", "G2", "G3", "New Agent", "Video Volume", "GMV Contest", "Tiktoktshopbonus"
- Deduplicate by id, keep only agents with created_time >= ${w.d30.start}
- Completeness guard: if any bucket hits 25 results AND total > 25, add narrower date-string queries until no bucket overflows
- For EVERY in-window agent call get_outreach_agent(campaignId=id, storeId=${storeId}) to get filter/commission details
- Field map: id, name, agent_type ("outreach"/"crm"), campaign_type, status (bot_status), date_posted (created_time date YYYY-MM-DD), gmv_filter (target_gmvs joined ", "; "none" if empty — never derive from name), kw_filter (target_categories joined ", "; "none" if empty), other_filters (concise summary of other non-empty target_* fields; "none" if all empty), list_segment (lists/segments names or targeting_method; "none" if absent), commission_display (unique rate + shop ads if present; "none" if absent), creators_reached (total_conversations), remaining (remaining_creators), total_invites, accepted_invites, total_replies, samples_requested (total_sample_request), samples_shipped, total_videos, total_revenue, product_count (length of products array), has_followups

OUTPUT — respond with ONLY this JSON object, nothing before or after:
{
  "d30": {
    "gmv": 0, "gmvPct": 0, "orders": 0, "ordersPct": 0,
    "videos": 0, "videosPct": 0, "views": 0, "viewsPct": 0,
    "creators": 0, "creatorsPct": 0, "newCreators": 0, "newCreatorsPct": 0,
    "retention": 0, "retentionDelta": 0,
    "gmvMax": { "spend": 0, "revenue": 0, "roi": 0 },
    "gmvMaxByAge": [{ "label":"< 30 days","videos":0,"spend":0,"revenue":0,"roi":0,"pct":0 }],
    "msgs": 0, "msgsPct": 0, "samples": 0, "samplesPct": 0,
    "tiers": {
      "g1": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "g2": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "g3": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 }
    }
  },
  "tables": {
    "topCreators": [{ "h":"handle","flw":0,"sgmv":0,"ggmv":0,"views":0,"v30":0,"vmgmv":0,"vlife":0,"v7":0,"ord":0,"aov":0,"eng":null }],
    "topVideos": [{ "h":"handle","ggmv":0,"prod":"product name","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":"" }],
    "activeCreators": [{ "h":"handle","ggmv":0,"flw":0,"v30":0,"gmvN":0,"gmvT":0,"views":0,"avgv":0,"ord":0 }]
  },
  "agents": [{ "id":0,"name":"","agent_type":"outreach","campaign_type":"","status":"running","date_posted":"YYYY-MM-DD","gmv_filter":"","kw_filter":"","other_filters":"","list_segment":"","commission_display":"","creators_reached":0,"remaining":0,"total_invites":0,"accepted_invites":0,"total_replies":0,"samples_requested":0,"samples_shipped":0,"total_videos":0,"total_revenue":0,"product_count":0,"has_followups":false }]
}`

  return NextResponse.json({ prompt, reportDate: w.reportDate, dataWindow: w.dataWindow })
}
