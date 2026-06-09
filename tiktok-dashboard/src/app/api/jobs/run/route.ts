import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { request as httpsRequest } from 'https'

// Use Node.js https directly to avoid undici's 300s headersTimeout limit
function anthropicPost(apiKey: string, bodyStr: string, timeoutMs: number): Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-04-04',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8')
        const status = res.statusCode || 0
        resolve({ ok: status >= 200 && status < 300, status, text: async () => text })
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Anthropic request timeout after ' + Math.round(timeoutMs/1000) + 's')))
    req.write(bodyStr)
    req.end()
  })
}

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
  `You are a data extraction agent for Ruff Liners TikTok Shop. STORE ID: ${process.env.EUKA_STORE_ID}
Current 30d: ${w.d30.start} to ${w.d30.end} | Prior 30d: ${w.prior.start} to ${w.prior.end}
13 weeks: ${w.weeksRange} | 6 months: ${w.monthKeys}
RULES: Always specify year 2026 in queries. Read every CSV with read_sandbox_file. Use creator_store_performance for GMV. New creators = first-ever video for this store. GMV Max only from May 14 2026 (use 0 if earlier).
CRITICAL OUTPUT RULE: You MUST respond with ONLY a single JSON object. No explanations, no analysis, no markdown, no prose before or after. Your entire response must start with { and end with }. Fill in real numbers from the data.`

// ONE query per phase — each phase is one Vercel function call (maxDuration=800)
const PHASES: Record<number, { label: string; prompt: (w: ReturnType<typeof buildWindows>, pd: any) => string; promptLive?: (w: ReturnType<typeof buildWindows>, pd: any) => string; mcp: boolean; isAgents?: boolean; maxTokens?: number; optional?: boolean }> = {
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
    prompt: w => BASE(w) + `\n\nQuery: Current 30d (${w.d30.start}–${w.d30.end}) by creator tier — pull every creator from creator_store_performance who posted in this window, classify each by their global gmv_30d (G1 <$25K, G2 $25K–$100K, G3 >$100K), then sum: creators who posted, new creators, videos posted, total views, and STORE GMV (the same gmv field from creator_store_performance, NOT global GMV). G1+G2+G3 store GMV must sum to the overall 30d total. Once you have the data, output ONLY the JSON — no analysis, no explanation.\nReturn ONLY: {"A3":{"g1":{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0},"g2":{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0},"g3":{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}}}`
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
    prompt: w => BASE(w) + `\n\nQuery: GMV Max current 30d (${w.d30.start}–${w.d30.end}): (1) total ad spend, attributed revenue, blended ROI; (2) ad spend and ROI broken down by creator tier (classify each video's creator by global gmv_30d: G1 <$25K, G2 $25K–$100K, G3 >$100K). Use 0 for all if data unavailable before May 14 2026.\nOutput: {"A6":{"spend":0,"revenue":0,"roi":0,"g1":{"spend":0,"roi":0},"g2":{"spend":0,"roi":0},"g3":{"spend":0,"roi":0}}}`
  },
  7: {
    label: 'Pulling GMV Max content age…',
    mcp: true,
    optional: true,
    prompt: w => BASE(w) + `\n\nQuery: GMV Max spend current 30d (${w.d30.start}–${w.d30.end}) broken down by how old the video was at the end of the window. Buckets based on video publish date vs ${w.d30.end}: "< 30 days" (posted ${w.d30.start}–${w.d30.end}), "1–2 months" (31–60 days before ${w.d30.end}), "2–3 months" (61–90 days), "3–5 months" (91–150 days), "5+ months" (151+ days), "Unknown post date" (publish date missing or unavailable). For each non-empty bucket output: label, videos (count), spend, revenue, roi (revenue/spend, 0 if no spend), pct (spend as % of total spend).\nOutput: {"A7":[{"label":"< 30 days","videos":0,"spend":0,"revenue":0,"roi":0,"pct":0}]}`
  },
  8: {
    label: 'Pulling outreach agents…',
    mcp: true,
    optional: true,
    isAgents: true,
    maxTokens: 8000,
    promptLive: w => {
      const startDate = w.d30.start
      return `You are a data extraction agent for Ruff Liners TikTok Shop.

STORE_ID: ${process.env.EUKA_STORE_ID}

GOAL: Return a JSON array of every outreach AND CRM agent created since ${startDate}. List-only — do NOT call get_outreach_agent for enrichment.

STEP 1 — Enumerate
list_outreach_agents caps at limit=25 per call. On every call pass: botStatus=["running","stopped","error"], limit=25, archived=false, storeId=${process.env.EUKA_STORE_ID}.

Run these searches:
OUTREACH (agentType="outreach"), searchQuery = "", "G1", "G2", "G3", "Video Volume", "GMV Contest", "New Agent"
CRM (agentType="crm"), searchQuery = "", "G1", "G2", "G3", "New Agent", "Video Volume", "GMV Contest", "Tiktoktshopbonus"

Merge all results → deduplicate by id → drop any agent with created_time older than ${startDate}.

STEP 2 — Field map (from list data only — omit any field not returned by the list tool)
id, name, agent_type ("outreach"/"crm"), campaign_type, status (bot_status), date_posted (created_time date only YYYY-MM-DD), creators_reached (total_conversations), remaining (remaining_creators), total_invites, accepted_invites, total_replies, samples_requested (total_sample_request), samples_shipped, total_videos, total_revenue, product_count (length of products array). Set gmv_filter, kw_filter, other_filters, list_segment, commission_display to "" and has_followups to false.

STEP 3 — Output
Respond with ONLY the JSON array. No prose, no markdown fences.
[{"id":0,"name":"","agent_type":"outreach","campaign_type":"","status":"running","date_posted":"YYYY-MM-DD","gmv_filter":"","kw_filter":"","other_filters":"","list_segment":"","commission_display":"","creators_reached":0,"remaining":0,"total_invites":0,"accepted_invites":0,"total_replies":0,"samples_requested":0,"samples_shipped":0,"total_videos":0,"total_revenue":0,"product_count":0,"has_followups":false}]`
    },
    prompt: w => {
      const startDate = w.d30.start  // agents: current 30d window
      const endDate = w.reportDate
      return `You are a data extraction agent for Ruff Liners TikTok Shop.

STORE_ID: ${process.env.EUKA_STORE_ID}

GOAL: Return a JSON array of every outreach AND CRM agent created in the last 30 days, each fully enriched.

## STEP 0 — Window
- CUTOFF = ${startDate} (inclusive)
- The list tool has no date parameter. Filter client-side: keep an agent only if the date portion of its created_time (UTC) is >= ${startDate}. Do not look for a date filter on the tool — there isn't one.

## STEP 1 — Enumerate
list_outreach_agents caps at limit=25 per call and has no pagination. On every call pass: botStatus=["running","stopped","error"], limit=25, archived=false, storeId=${process.env.EUKA_STORE_ID}.

Run these searches:
OUTREACH (agentType="outreach"), searchQuery = "", "G1", "G2", "G3", "Video Volume", "GMV Contest", "New Agent"
CRM (agentType="crm"), searchQuery = "", "G1", "G2", "G3", "New Agent", "Video Volume", "GMV Contest", "Tiktoktshopbonus"

Merge all results → deduplicate by id → drop any agent with created_time older than ${startDate}.

Completeness guard: if any single searchQuery in-window count hits the 25-row cap AND that call's total > 25, add narrower date-string queries and repeat until no bucket is truncated.

## STEP 2 — Enrich
For EVERY in-window agent, call get_outreach_agent(campaignId=id, storeId=${process.env.EUKA_STORE_ID}).

## STEP 3 — Field map
id, name, agent_type ("outreach"/"crm"), campaign_type, status (bot_status), date_posted (created_time date only YYYY-MM-DD), gmv_filter (target_gmvs joined ", "; "none" if empty), kw_filter (target_categories joined ", "; "none" if empty), other_filters (concise summary of other non-empty target_* fields; "none" if all empty), list_segment (lists names or segments names or targeting_method; "none" if absent), commission_display (unique commission rate + shop ads if present; "none" if absent), creators_reached (total_conversations), remaining (remaining_creators), total_invites (total_target_invites), accepted_invites (total_target_accepted_invites), total_replies, samples_requested (total_sample_request), samples_shipped (total_samples_shipped), total_videos, total_revenue, product_count (length of products array), has_followups

## STEP 4 — Output
Respond with ONLY the JSON array. No prose, no markdown fences.
[{"id":0,"name":"","agent_type":"outreach","campaign_type":"","status":"running","date_posted":"YYYY-MM-DD","gmv_filter":"","kw_filter":"","other_filters":"","list_segment":"","commission_display":"","creators_reached":0,"remaining":0,"total_invites":0,"accepted_invites":0,"total_replies":0,"samples_requested":0,"samples_shipped":0,"total_videos":0,"total_revenue":0,"product_count":0,"has_followups":false}]`
    }
  },
  // live_refresh saves after phase 8 (A1-A8 complete, includes agents)
  9: {
    label: 'Pulling top 15 creators…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Top 15 creators by store GMV (${w.d30.start}–${w.d30.end}): handle, followers, store GMV, global gmv_30d, views, videos L30d, videos with any GMV L30d, lifetime videos for this store, videos L7d, orders, AOV, engagement rate.\nOutput: {"topCreators":[{"h":"","flw":0,"sgmv":0,"ggmv":0,"views":0,"v30":0,"vmgmv":0,"vlife":0,"v7":0,"ord":0,"aov":0,"eng":null}]}`
  },
  10: {
    label: 'Pulling top 15 videos…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Top 15 videos by store GMV (${w.d30.start}–${w.d30.end}): creator handle, product name (shorten: "Hard Bottom Backseat Extenders for Dogs with Door Protection"→"Back Seat Ext.", "XL Floor Cover for Full-Size Crew Cab Trucks with Fold Up Seats"→"XL Floor Cover", "Travel Dog Bed for Car"→"Travel Dog Bed"), GMV, views, orders, AOV, publish date, likes, comments, product clicks.\nOutput: {"topVideos":[{"h":"","ggmv":0,"prod":"","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":""}]}`
  },
  11: {
    label: 'Pulling most active creators…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Top 15 creators by videos posted (${w.d30.start}–${w.d30.end}): handle, global GMV, followers, videos posted, GMV from those videos (new video GMV), total store GMV, total views, avg views per video, orders.\nOutput: {"activeCreators":[{"h":"","ggmv":0,"flw":0,"v30":0,"gmvN":0,"gmvT":0,"views":0,"avgv":0,"ord":0}]}`
  },
  12: {
    label: 'Pulling 13-week GMV trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Weekly GMV + orders for all 13 Sun–Sat weeks in ${w.weeksRange}. Return 13 rows in chronological order.\nOutput (exactly 13 items): {"C1":[{"gmv":0,"orders":0}]}`
  },
  13: {
    label: 'Pulling 13-week creator trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Weekly creators, new creators, videos posted, views, store GMV by tier (G1/G2/G3) for all 13 weeks in ${w.weeksRange}. Return 13 rows per tier.\nOutput (exactly 13 items per array): {"C2":{"g1":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}],"g2":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}],"g3":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}]}}`
  },
  14: {
    label: 'Pulling 13-week retention & video trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Weekly retention rate + total videos posted + total views for all 13 weeks in ${w.weeksRange}.\nOutput (exactly 13 items): {"C3":[0],"C4":[{"videos":0,"views":0}]}`
  },
  15: {
    label: 'Pulling 13-week outreach trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Weekly messages sent + samples shipped by tier (G1/G2/G3) for all 13 weeks in ${w.weeksRange}.\nOutput (exactly 13 items per array): {"C5":{"g1":[{"msgs":0,"samples":0}],"g2":[{"msgs":0,"samples":0}],"g3":[{"msgs":0,"samples":0}]}}`
  },
  16: {
    label: 'Pulling 6-month GMV trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Monthly GMV + views for each of the 6 months: ${w.monthKeys}. Return 6 rows chronological.\nOutput (exactly 6 items): {"D1":[{"gmv":0,"views":0}]}`
  },
  17: {
    label: 'Pulling 6-month creator trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Monthly creators, new creators, videos, views, store GMV by tier (G1/G2/G3) for months ${w.monthKeys}. Return 6 rows per tier.\nOutput (exactly 6 items per array): {"D2":{"g1":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}],"g2":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}],"g3":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}]}}`
  },
  18: {
    label: 'Pulling 6-month retention & outreach…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Monthly retention rate + outreach (messages sent + samples shipped by tier G1/G2/G3) for months ${w.monthKeys}.\nOutput (exactly 6 items per array): {"D3":[0],"D4":{"g1":[{"msgs":0,"samples":0}],"g2":[{"msgs":0,"samples":0}],"g3":[{"msgs":0,"samples":0}]}}`
  },
  19: {
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
  20: {
    label: 'Saving report…',
    mcp: false,
    prompt: () => '' // handled in code, not via claude
  }
}

const LIVE_SAVE_AFTER = 11  // live_refresh saves after phase 11 (KPIs + agents + all 3 tables complete)
const TOTAL_PHASES = 20

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
      gmvMaxByAge:(pd.A7&&pd.A7.length>0)?pd.A7:undefined,
      msgs:a4.total?.msgs||0, msgsPct:pct(a4.total?.msgs||0,a5.total?.msgs||0),
      samples:a4.total?.samples||0, samplesPct:pct(a4.total?.samples||0,a5.total?.samples||0),
      tiers:{
        g1:{creators:a3.g1?.creators||0,newCreators:a3.g1?.newCreators||0,videos:a3.g1?.videos||0,views:a3.g1?.views||0,gmv:a3.g1?.gmv||0,gmvMaxSpend:a6.g1?.spend||undefined,gmvMaxRoi:a6.g1?.roi||undefined,msgs:a4.g1?.msgs||0,msgsPct:pct(a4.g1?.msgs||0,a5.g1?.msgs||0),samples:a4.g1?.samples||0,samplesPct:pct(a4.g1?.samples||0,a5.g1?.samples||0)},
        g2:{creators:a3.g2?.creators||0,newCreators:a3.g2?.newCreators||0,videos:a3.g2?.videos||0,views:a3.g2?.views||0,gmv:a3.g2?.gmv||0,gmvMaxSpend:a6.g2?.spend||undefined,gmvMaxRoi:a6.g2?.roi||undefined,msgs:a4.g2?.msgs||0,msgsPct:pct(a4.g2?.msgs||0,a5.g2?.msgs||0),samples:a4.g2?.samples||0,samplesPct:pct(a4.g2?.samples||0,a5.g2?.samples||0)},
        g3:{creators:a3.g3?.creators||0,newCreators:a3.g3?.newCreators||0,videos:a3.g3?.videos||0,views:a3.g3?.views||0,gmv:a3.g3?.gmv||0,gmvMaxSpend:a6.g3?.spend||undefined,gmvMaxRoi:a6.g3?.roi||undefined,msgs:a4.g3?.msgs||0,msgsPct:pct(a4.g3?.msgs||0,a5.g3?.msgs||0),samples:a4.g3?.samples||0,samplesPct:pct(a4.g3?.samples||0,a5.g3?.samples||0)}
      }
    },
    weekly_charts:{
      labels:w.weekLabels, gmv:c1.map((r:any)=>r.gmv||0), views:c4.map((r:any)=>r.views||0),
      crg1:c2.g1?.map((r:any)=>r.creators||0)||[], crg2:c2.g2?.map((r:any)=>r.creators||0)||[], crg3:c2.g3?.map((r:any)=>r.creators||0)||[],
      ncg1:c2.g1?.map((r:any)=>r.newCreators||0)||[], ncg2:c2.g2?.map((r:any)=>r.newCreators||0)||[], ncg3:c2.g3?.map((r:any)=>r.newCreators||0)||[],
      vg1:c2.g1?.map((r:any)=>r.videos||0)||[], vg2:c2.g2?.map((r:any)=>r.videos||0)||[], vg3:c2.g3?.map((r:any)=>r.videos||0)||[],
      gg1:c2.g1?.map((r:any)=>r.gmv||0)||[], gg2:c2.g2?.map((r:any)=>r.gmv||0)||[], gg3:c2.g3?.map((r:any)=>r.gmv||0)||[],
      vwg1:c2.g1?.map((r:any)=>r.views||0)||[], vwg2:c2.g2?.map((r:any)=>r.views||0)||[], vwg3:c2.g3?.map((r:any)=>r.views||0)||[],
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
      vwg1:d2.g1?.map((r:any)=>r.views||0)||[], vwg2:d2.g2?.map((r:any)=>r.views||0)||[], vwg3:d2.g3?.map((r:any)=>r.views||0)||[],
      ret:d3.map((r:any)=>typeof r==='number'?r:0),
      mg1:d4.g1?.map((r:any)=>r.msgs||0)||[], mg2:d4.g2?.map((r:any)=>r.msgs||0)||[], mg3:d4.g3?.map((r:any)=>r.msgs||0)||[],
      sg1:d4.g1?.map((r:any)=>r.samples||0)||[], sg2:d4.g2?.map((r:any)=>r.samples||0)||[], sg3:d4.g3?.map((r:any)=>r.samples||0)||[]
    },
    tables:{topCreators:pd.topCreators||[], topVideos:pd.topVideos||[], activeCreators:pd.activeCreators||[]},
    agents:pd.agents||[],
    analysis:{d30:analysis?.d30||'', weekly:analysis?.weekly||'', monthly:analysis?.monthly||''}
  }
}

async function getAnthropicKey(): Promise<string|null> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try { const {data}=await supabaseAdmin().from('app_config').select('value').eq('key','anthropic_api_key').single(); return (data?.value as string)??null } catch { return null }
}

function extractTextBlocks(data: any): string {
  return (data.content||[]).filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n')
}

// MCP phases: single attempt, 680s — leaves ~120s for follow-up + Vercel overhead within 800s limit
// Non-MCP phases (analysis, follow-up): 120s is plenty
async function callClaudeRaw(body: any, apiKey: string, timeoutMs = 680_000): Promise<any> {
  const bodyStr = JSON.stringify(body)
  let res: Awaited<ReturnType<typeof anthropicPost>>
  try {
    res = await anthropicPost(apiKey, bodyStr, timeoutMs)
  } catch (e: any) {
    // Only retry on connection-level errors (ECONNRESET, ETIMEDOUT from OS), not our own timeout
    const isConnectionErr = e?.message && !e.message.includes('timeout after')
    if (isConnectionErr) {
      console.warn('Connection error, retrying in 3s…', e.message)
      await new Promise(r => setTimeout(r, 3000))
      res = await anthropicPost(apiKey, bodyStr, timeoutMs).catch((e2: any) => {
        throw new Error(`Anthropic API unreachable: ${e2?.message}`)
      })
    } else {
      throw new Error(`Anthropic API unreachable: ${e?.message}`)
    }
  }
  if (!res.ok) { const t = await res.text(); throw new Error(`Claude API ${res.status}: ${t.slice(0,300)}`) }
  return JSON.parse(await res.text())
}

async function callClaude(prompt: string, apiKey: string, withMcp: boolean, maxTokens = 4000): Promise<string> {
  const body: any = { model: 'claude-sonnet-4-6', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }
  if (withMcp) {
    const raw = (process.env.EUKA_BEARER_TOKEN||'').trim()
    const tok = raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw
    const srv: any = { type: 'url', url: process.env.EUKA_MCP_URL!, name: 'euka' }
    if (tok) srv.authorization_token = tok
    body.mcp_servers = [srv]
  }

  // MCP call: 680s. Non-MCP: 120s. Agents: 750s (complex multi-step enumeration).
  const timeoutMs = withMcp ? (maxTokens > 4000 ? 750_000 : 680_000) : 120_000

  // Retry up to 2 times on MCP connection errors (transient Euka server unavailability)
  let data: any
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 8000
      console.warn(`MCP connection error, retry ${attempt}/2 after ${delay/1000}s…`)
      await new Promise(r => setTimeout(r, delay))
    }
    try {
      data = await callClaudeRaw(body, apiKey, timeoutMs)
      lastErr = null
      break
    } catch (e: any) {
      const isMcpConnErr = e?.message?.includes('Connection error while communicating with MCP')
      if (isMcpConnErr && attempt < 2) { lastErr = e; continue }
      throw e
    }
  }
  if (lastErr) throw lastErr
  const text = extractTextBlocks(data)

  // If no JSON in the response, send a follow-up turn (no MCP needed, 90s is plenty)
  if (text.indexOf('{') === -1) {
    console.warn('No JSON in first response, sending JSON-coerce follow-up turn')
    const followUpBody: any = {
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: data.content || [] },
        { role: 'user', content: 'Now output ONLY the JSON object with the exact structure I specified. Start your response with { and end with }. Nothing else.' }
      ]
    }
    const followUpData = await callClaudeRaw(followUpBody, apiKey, 90_000)
    return extractTextBlocks(followUpData)
  }

  return text
}

function extractJson(text: string): any {
  const s=text.indexOf('{'), e=text.lastIndexOf('}')
  if (s===-1||e===-1) throw new Error('No JSON in Claude response')
  const slice = text.slice(s,e+1)
  try {
    return JSON.parse(slice)
  } catch {
    // try to find the outermost valid JSON object by scanning for balanced braces
    let depth=0, start=-1, end=-1
    for (let i=0;i<text.length;i++) {
      if (text[i]==='{') { if (depth===0) start=i; depth++ }
      else if (text[i]==='}') { depth--; if (depth===0 && start!==-1) { end=i; break } }
    }
    if (start===-1||end===-1) throw new Error('No JSON in Claude response')
    return JSON.parse(text.slice(start,end+1))
  }
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

    if (nextPhase === 20) {
      // Save phase — phase 19 stores analysis keys at top level of pd
      const analysis = { d30: pd.d30||'', weekly: pd.weekly||'', monthly: pd.monthly||'' }
      const report = assemble(w, pd, analysis)
      await supabase.from('weekly_reports').upsert(report, { onConflict:'report_date' })
      await supabase.from('report_jobs').update({ status:'done', phase:20, phase_label:'Complete ✓', updated_at:new Date().toISOString() }).eq('id',jobId)
      return NextResponse.json({ ok:true, nextPhase:null })
    }

    let text: string
    const activePrompt = phaseConfig.promptLive
      ? phaseConfig.promptLive(w, pd)
      : phaseConfig.prompt(w, pd)
    try {
      text = await callClaude(activePrompt, apiKey, phaseConfig.mcp, phaseConfig.maxTokens)
    } catch (e: any) {
      if (!phaseConfig.optional) throw e
      // Optional phase failed — log error into phase_data so it's visible, set defaults, continue
      const errMsg = e?.message?.slice(0,400) || 'unknown error'
      console.warn(`Optional phase ${nextPhase} skipped: ${errMsg}`)
      pd[`_phase${nextPhase}Error`] = errMsg
      if (phaseConfig.isAgents) pd.agents = []
      await upd(nextPhase, `Phase ${nextPhase} unavailable`)
      // Still do live save if this was the final live phase
      if (isLive && nextPhase === LIVE_SAVE_AFTER) {
        const fullReport = assemble(w, pd, { d30:'', weekly:'', monthly:'' })
        const liveData = { report_date: fullReport.report_date, label: fullReport.label, data_window: fullReport.data_window, d30: fullReport.d30, tables: fullReport.tables, agents: fullReport.agents, analysis: { d30:'' } }
        await supabase.from('app_config').upsert({ key:'live_report', value: JSON.stringify(liveData) }, { onConflict:'key' })
        await supabase.from('report_jobs').update({ status:'done', phase:nextPhase, phase_label:'Done ✓', updated_at:new Date().toISOString() }).eq('id',jobId)
        return NextResponse.json({ ok:true, nextPhase:null })
      }
      const next = nextPhase + 1
      return NextResponse.json({ ok:true, nextPhase: next > TOTAL_PHASES ? null : next })
    }

    if (phaseConfig.isAgents) {
      // Agents response is a JSON array; extract it directly
      const start = text.indexOf('['), end = text.lastIndexOf(']')
      if (start !== -1 && end !== -1) {
        try { pd.agents = JSON.parse(text.slice(start, end + 1)) } catch { pd.agents = [] }
      } else {
        pd.agents = []
      }
      await upd(nextPhase, `Phase ${nextPhase} done`)
    } else {
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
    }

    // live_refresh: save after collecting A1-A7 + agents (phases 1-8)
    // Writes to app_config key 'live_report' — never touches weekly_reports
    if (isLive && nextPhase === LIVE_SAVE_AFTER) {
      const fullReport = assemble(w, pd, { d30:'', weekly:'', monthly:'' })
      const liveData = {
        report_date: fullReport.report_date,
        label: fullReport.label,
        data_window: fullReport.data_window,
        d30: fullReport.d30,
        tables: fullReport.tables,
        agents: fullReport.agents,
        analysis: { d30:'' },
      }
      await supabase.from('app_config').upsert({ key:'live_report', value: JSON.stringify(liveData) }, { onConflict:'key' })
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
