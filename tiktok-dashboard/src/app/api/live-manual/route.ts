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
    d30 = phaseData.d30
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

QUERIES TO RUN:
1. Current 30d totals: GMV, orders, videos posted, views, creators posted, new creators (first-ever post for this store), retention rate vs prior period
2. Prior 30d: same totals for % change calculations
3. Current 30d by creator tier (G1 = global gmv_30d <$25K, G2 = $25K–$100K, G3 = >$100K): creators, new creators, videos posted, store GMV
4. Current 30d outreach by tier: messages sent + samples shipped, plus overall totals
5. Prior 30d outreach: totals + by tier (for % change)
6. GMV Max current 30d: total ad spend, attributed revenue, blended ROI (use 0 if before May 14 2026)
7. Top 15 creators by store GMV — handle, followers, store GMV, global gmv_30d, views, videos L30d, videos w/GMV L30d, lifetime videos, videos L7d, orders, AOV, engagement rate
8. Top 15 videos by store GMV — creator handle, product name, GMV, views, orders, AOV, publish date, likes, comments, product clicks
9. Top 15 creators by videos posted — handle, followers, GMV from new-period videos only, total store GMV, views, avg views/video, orders

Product name shortening: "Hard Bottom Backseat Extenders for Dogs with Door Protection" → "Back Seat Ext." · "XL Floor Cover for Full-Size Crew Cab Trucks with Fold Up Seats" → "XL Floor Cover" · "Travel Dog Bed for Car" → "Travel Dog Bed"

OUTPUT — respond with ONLY this JSON object, nothing before or after it:
{
  "d30": {
    "gmv": 0, "gmvPct": 0, "orders": 0, "ordersPct": 0,
    "videos": 0, "videosPct": 0, "views": 0, "viewsPct": 0,
    "creators": 0, "creatorsPct": 0, "newCreators": 0, "newCreatorsPct": 0,
    "retention": 0, "retentionDelta": 0,
    "gmvMax": { "spend": 0, "revenue": 0, "roi": 0 },
    "msgs": 0, "msgsPct": 0, "samples": 0, "samplesPct": 0,
    "tiers": {
      "g1": { "creators":0,"newCreators":0,"videos":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "g2": { "creators":0,"newCreators":0,"videos":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "g3": { "creators":0,"newCreators":0,"videos":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 }
    }
  },
  "tables": {
    "topCreators": [{ "h":"handle","flw":0,"sgmv":0,"ggmv":0,"views":0,"v30":0,"vmgmv":0,"vlife":0,"v7":0,"ord":0,"aov":0,"eng":null }],
    "topVideos": [{ "h":"handle","ggmv":0,"prod":"product name","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":"" }],
    "activeCreators": [{ "h":"handle","ggmv":0,"flw":0,"v30":0,"gmvN":0,"gmvT":0,"views":0,"avgv":0,"ord":0 }]
  }
}`

  const agentsPrompt = `You are a data extraction agent for Ruff Liners TikTok Shop.

STORE_ID: ${storeId}
EUKA_MCP: https://app.euka.ai/api/mcp

GOAL: Return a JSON array of every outreach AND CRM agent created in the last 30 days, each fully enriched.

## STEP 0 — Window

- TODAY = ${w.label}
- CUTOFF = TODAY − 30 days (inclusive) = ${w.d30.start}
- The list tool has no date parameter. Filter client-side: keep an agent only if the date portion of its created_time (UTC) is >= ${w.d30.start}. Do not look for a date filter on the tool — there isn't one.

## STEP 1 — Enumerate

list_outreach_agents caps at limit=25 per call and has no pagination. On every call pass: botStatus=["running","stopped","error"], limit=25, archived=false, storeId=${storeId}.

Run these searches:

OUTREACH (agentType="outreach"), searchQuery =
"", "G1", "G2", "G3", "Video Volume", "GMV Contest", "New Agent"

CRM (agentType="crm"), searchQuery =
"", "G1", "G2", "G3", "New Agent", "Video Volume", "GMV Contest", "Tiktoktshopbonus"

Merge all results → deduplicate by id → drop any agent with created_time older than ${w.d30.start}.

Completeness guard. Each response includes a total. If, for any single searchQuery, your in-window count for that bucket hits the 25-row cap AND that call's total > 25, the bucket overflowed — add narrower date-string queries for it (e.g. "G2 - 5/2", "G2 - 5/1", "G2 - 4/3") and repeat until no in-window bucket is truncated. If you cannot confirm full in-window coverage, stop and report the gap — never return a partial array.

## STEP 2 — Enrich

For EVERY in-window agent, call get_outreach_agent(campaignId=id, storeId=${storeId}). This is the only source for gmv_filter, kw_filter, other_filters, list_segment, and commission_display.

## STEP 3 — Field map

| Output field        | Source |
|---------------------|--------|
| id                  | list.id |
| name                | list.campaign_name |
| agent_type          | "outreach" or "crm" — whichever list call produced it |
| campaign_type       | list.campaign_type |
| status              | list.bot_status |
| date_posted         | list.created_time, date only, YYYY-MM-DD |
| gmv_filter          | detail.target_gmvs joined with ", ", verbatim (e.g. "$100-$25.0K"). "none" if null/empty. NEVER derive from the campaign name. |
| kw_filter           | detail.target_categories joined with ", "; "none" if empty |
| other_filters       | Concise key: value summary of any other non-empty detail.target_* fields (target_avg_shoppable_video_views, target_avg_live_views, target_follower_counts, target_engagement_rate, target_creator_gender/target_gender, target_creator_languages, target_ages, target_fulfillment_rate, target_live_gmvs, target_ethnicity). "none" if all empty |
| list_segment        | If detail.lists non-empty → join their names; else if detail.segments non-empty → join their names; else detail.targeting_method ("filters"/"list"/"segment"); "none" if absent |
| commission_display  | Build from detail.product_commission_with_percentage (unique value, e.g. "20%") + if detail.include_shop_ads and detail.shop_ads_commission → append " + N% Shop Ads". Example: "20% + 6% Shop Ads". "none" if no commission data |
| creators_reached    | list.total_conversations |
| remaining           | list.remaining_creators |
| total_invites       | list.total_target_invites |
| accepted_invites    | list.total_target_accepted_invites |
| total_replies       | list.total_replies |
| samples_requested   | list.total_sample_request |
| samples_shipped     | list.total_samples_shipped |
| total_videos        | list.total_videos |
| total_revenue       | list.total_revenue |
| product_count       | length of list.products (0 if null) |
| has_followups       | list.has_followups |

## STEP 4 — Output

Respond with ONLY the JSON array [ ... ]. No prose, no markdown fences. One object per in-window agent.

{ "id":0,"name":"","agent_type":"outreach","campaign_type":"","status":"running","date_posted":"YYYY-MM-DD","gmv_filter":"","kw_filter":"","other_filters":"","list_segment":"","commission_display":"","creators_reached":0,"remaining":0,"total_invites":0,"accepted_invites":0,"total_replies":0,"samples_requested":0,"samples_shipped":0,"total_videos":0,"total_revenue":0,"product_count":0,"has_followups":false }`

  return NextResponse.json({ prompt, agentsPrompt, reportDate: w.reportDate, dataWindow: w.dataWindow })
}
