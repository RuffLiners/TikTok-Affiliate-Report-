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
    weeksRange: `${f(weeks[0].start)} to ${f(lastSat)}`,
    monthKeys: months.map(m => m.key).join(', '),
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
    },
    tables: {
      topCreators: pd.topCreators || [],
      topVideos: pd.topVideos || [],
      activeCreators: pd.activeCreators || [],
    }
  }
}

// POST — accept phase data, assemble, merge into report
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
  const hasAgents = Array.isArray(phaseData.agents) && phaseData.agents.length > 0

  const hasTables = assembled.tables.topCreators.length > 0 ||
    assembled.tables.topVideos.length > 0 ||
    assembled.tables.activeCreators.length > 0

  const { data: existing } = await supabase
    .from('weekly_reports')
    .select('report_date')
    .eq('report_date', w.reportDate)
    .maybeSingle()

  if (existing) {
    const updatePayload: any = {
      d30: assembled.d30,
      label: assembled.label,
      data_window: assembled.data_window,
    }
    if (hasTables) updatePayload.tables = assembled.tables
    if (hasAgents) updatePayload.agents = phaseData.agents
    const { error } = await supabase.from('weekly_reports').update(updatePayload).eq('report_date', w.reportDate)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await supabase.from('weekly_reports').insert({
      report_date: w.reportDate,
      label: assembled.label,
      data_window: assembled.data_window,
      d30: assembled.d30,
      tables: assembled.tables,
      agents: hasAgents ? phaseData.agents : [],
      weekly_charts: { labels:[], gmv:[], views:[], crg1:[], crg2:[], crg3:[], ncg1:[], ncg2:[], ncg3:[], vg1:[], vg2:[], vg3:[], gg1:[], gg2:[], gg3:[], ret:[], vid:[], mg1:[], mg2:[], mg3:[], sg1:[], sg2:[], sg3:[] },
      monthly_charts: { labels:[], gmv:[], views:[], crg1:[], crg2:[], crg3:[], ncg1:[], ncg2:[], ncg3:[], vg1:[], vg2:[], vg3:[], gg1:[], gg2:[], gg3:[], ret:[], mg1:[], mg2:[], mg3:[], sg1:[], sg2:[], sg3:[] },
      analysis: { d30:'', weekly:'', monthly:'' }
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  revalidatePath('/dashboard')
  return NextResponse.json({ ok: true, reportDate: w.reportDate, gmv: assembled.d30.gmv })
}

// GET — return all Claude prompts with live date windows and real store ID
export async function GET(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const reportDate = searchParams.get('reportDate')
  const today = reportDate ? new Date(reportDate + 'T12:00:00') : new Date()
  const w = buildWindows(today)

  // Read store ID server-side so it's never exposed as a literal string in prompts
  const storeId = process.env.EUKA_STORE_ID ?? ''

  const base = `You are a data extraction agent for Ruff Liners TikTok Shop. STORE ID: ${storeId}
Current 30d: ${w.d30.start} to ${w.d30.end} | Prior 30d: ${w.prior.start} to ${w.prior.end}
13 weeks: ${w.weeksRange} | 6 months: ${w.monthKeys}
RULES: Always specify year 2026 in queries. Read every CSV with read_sandbox_file. Use creator_store_performance for GMV. New creators = first-ever video for this store. GMV Max only from May 14 2026 (use 0 if earlier).
CRITICAL OUTPUT RULE: You MUST respond with ONLY a single JSON object. Start with { and end with }. No prose, no markdown.`

  const prompt = `${base}

Run ALL of the following queries and return ONE combined JSON object with all keys. Do not stop early — complete every query before outputting.

1. Current 30d (${w.d30.start}–${w.d30.end}) totals from creator_store_performance: total GMV, orders, videos posted, views, total creators who posted, new creators (first-ever post for this store), retention rate. → key "A1"

2. Prior 30d (${w.prior.start}–${w.prior.end}) same totals. → key "A2"

3. Current 30d (${w.d30.start}–${w.d30.end}) by creator tier (G1 global gmv_30d <$25K, G2 $25K–$100K, G3 >$100K): creators who posted, new creators, videos posted, store GMV. → key "A3"

4. Current 30d (${w.d30.start}–${w.d30.end}) outreach totals + by tier: messages sent, samples shipped. → key "A4"

5. Prior 30d (${w.prior.start}–${w.prior.end}) outreach totals + by tier: messages sent, samples shipped. → key "A5"

6. GMV Max current 30d (${w.d30.start}–${w.d30.end}): total ad spend, attributed revenue, blended ROI. Use 0 if before May 14 2026. → key "A6"

7. Top 15 creators by store GMV (${w.d30.start}–${w.d30.end}): handle, followers, store GMV, global gmv_30d, views, videos L30d, videos with any GMV L30d, lifetime videos for this store, videos L7d, orders, AOV, engagement rate. → key "topCreators"

8. Top 15 videos by store GMV (${w.d30.start}–${w.d30.end}): creator handle, product name (shorten: "Hard Bottom Backseat Extenders for Dogs with Door Protection"→"Back Seat Ext.", "XL Floor Cover for Full-Size Crew Cab Trucks with Fold Up Seats"→"XL Floor Cover", "Travel Dog Bed for Car"→"Travel Dog Bed"), GMV, views, orders, AOV, publish date, likes, comments, product clicks. → key "topVideos"

9. Top 15 creators by videos posted (${w.d30.start}–${w.d30.end}): handle, global GMV, followers, videos posted, GMV from those videos, total store GMV, total views, avg views per video, orders. → key "activeCreators"

10. All outreach AND CRM agents for this store: call list_outreach_agents with agentType="outreach" limit=50, then agentType="crm" limit=50. Return ALL agents from both lists. For each agent map: id, name, agent_type ("outreach"/"crm"), campaign_type, status (bot_status), date_posted (created_time as YYYY-MM-DD), gmv_filter (target_gmvs as range string or "none"), kw_filter (keyword filter or "—"), other_filters (other attribute filters or "none"), list_segment (list/segment name + size or "— (filter-based)"), commission_display (organic%/ads% e.g. "20% / 10%" or "—"), creators_reached (total_conversations), remaining (remaining_creators), total_invites (total_target_invites), accepted_invites (total_target_accepted_invites), total_replies, samples_requested (total_sample_request), samples_shipped (total_samples_shipped), total_videos, total_revenue, product_count (number of products), has_followups (boolean). → key "agents" (array)

Output ONLY this single JSON object with all 10 keys filled in with real data:
{
  "A1":{"gmv":0,"orders":0,"videos":0,"views":0,"creators":0,"newCreators":0,"retention":0},
  "A2":{"gmv":0,"orders":0,"videos":0,"views":0,"creators":0,"newCreators":0,"retention":0},
  "A3":{"g1":{"creators":0,"newCreators":0,"videos":0,"gmv":0},"g2":{"creators":0,"newCreators":0,"videos":0,"gmv":0},"g3":{"creators":0,"newCreators":0,"videos":0,"gmv":0}},
  "A4":{"total":{"msgs":0,"samples":0},"g1":{"msgs":0,"samples":0},"g2":{"msgs":0,"samples":0},"g3":{"msgs":0,"samples":0}},
  "A5":{"total":{"msgs":0,"samples":0},"g1":{"msgs":0,"samples":0},"g2":{"msgs":0,"samples":0},"g3":{"msgs":0,"samples":0}},
  "A6":{"spend":0,"revenue":0,"roi":0},
  "topCreators":[{"h":"","flw":0,"sgmv":0,"ggmv":0,"views":0,"v30":0,"vmgmv":0,"vlife":0,"v7":0,"ord":0,"aov":0,"eng":null}],
  "topVideos":[{"h":"","ggmv":0,"prod":"","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":""}],
  "activeCreators":[{"h":"","ggmv":0,"flw":0,"v30":0,"gmvN":0,"gmvT":0,"views":0,"avgv":0,"ord":0}],
  "agents":[{"id":0,"name":"","agent_type":"outreach","campaign_type":"","status":"running","date_posted":"","gmv_filter":"","kw_filter":"","other_filters":"","list_segment":"","commission_display":"","creators_reached":0,"remaining":0,"total_invites":0,"accepted_invites":0,"total_replies":0,"samples_requested":0,"samples_shipped":0,"total_videos":0,"total_revenue":0,"product_count":0,"has_followups":false}]
}`

  return NextResponse.json({ prompt, reportDate: w.reportDate, dataWindow: w.dataWindow })
}
