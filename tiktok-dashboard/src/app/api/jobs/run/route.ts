import { NextRequest, NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { reconcileD30 } from '@/lib/reconcile'
import { sanitizeRows, sanitizeTables } from '@/lib/sanitize'
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

// Data-extraction phases run many MCP tool calls; the analysis phase is pure
// reasoning and benefits from the strongest available model. Both overridable
// via Vercel env vars without a code change.
const EXTRACT_MODEL = (process.env.EXTRACTION_MODEL || 'claude-sonnet-4-6').trim()
const ANALYSIS_MODEL = (process.env.ANALYSIS_MODEL || EXTRACT_MODEL).trim()

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
    // current partial month: use today as end so MTD covers the full date range available
    return { key: format(d, 'yyyy-MM'), label: format(d, 'MMM') + (ip ? '*' : ''), start: startOfMonth(d), end: ip ? today : endOfMonth(d) }
  })
  const f = (d: Date) => format(d, 'yyyy-MM-dd')
  return {
    reportDate: format(today, 'yyyy-MM-dd'), label: format(today, 'MMMM d, yyyy'),
    dataWindow: `${format(gmvStart, 'MMM d')} – ${format(gmvEnd, 'MMM d, yyyy')}`,
    d30: { start: f(gmvStart), end: f(gmvEnd) }, prior: { start: f(priorStart), end: f(priorEnd) },
    last7: { start: f(last7Start), end: f(lastSat) }, weeks, months,
    currentMonthStart: f(startOfMonth(today)), currentMonthEnd: f(today),
    weekLabels: weeks.map(w => `${w.start.getMonth()+1}/${w.start.getDate()}`),
    monthLabels: months.map(m => m.label),
    weeksRange: `${f(weeks[0].start)} to ${f(lastSat)}`,
    monthKeys: months.map(m => m.key).join(', ')
  }
}

// Windows for a monthly report: the "current" window is the calendar month
// (capped at today-2 for the in-progress month), the prior window is the full
// previous month, so every existing phase prompt produces month vs month data.
function buildMonthlyWindows(monthKey: string, today: Date) {
  const mStart = startOfMonth(new Date(monthKey + '-01T00:00:00'))
  const mEndFull = endOfMonth(mStart)
  const dataCap = subDays(today, 2)
  const mEnd = dataCap < mEndFull ? dataCap : mEndFull
  const priorStart = startOfMonth(subMonths(mStart, 1))
  const priorEnd = endOfMonth(priorStart)

  const dow = mEnd.getDay()
  const lastSat = dow === 6 ? mEnd : subDays(mEnd, dow + 1)
  const last7Start = subDays(lastSat, 6)
  const weeks = Array.from({ length: 13 }, (_, i) => {
    const wEnd = subDays(lastSat, i * 7); return { start: subDays(wEnd, 6), end: wEnd }
  }).reverse()
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(mStart, 5 - i); const ip = i === 5
    return { key: format(d, 'yyyy-MM'), label: format(d, 'MMM') + (ip && mEnd < mEndFull ? '*' : ''), start: startOfMonth(d), end: ip ? mEnd : endOfMonth(d) }
  })
  const f = (d: Date) => format(d, 'yyyy-MM-dd')
  return {
    // 'YYYY-MM-M' can never collide with a weekly report's Monday date
    reportDate: `${monthKey}-M`,
    label: `${format(mStart, 'MMMM yyyy')} · Monthly`,
    dataWindow: `${format(mStart, 'MMM d')} – ${format(mEnd, 'MMM d, yyyy')}`,
    d30: { start: f(mStart), end: f(mEnd) }, prior: { start: f(priorStart), end: f(priorEnd) },
    last7: { start: f(last7Start), end: f(lastSat) }, weeks, months,
    currentMonthStart: f(mStart), currentMonthEnd: f(mEnd),
    weekLabels: weeks.map(w => `${w.start.getMonth()+1}/${w.start.getDate()}`),
    monthLabels: months.map(m => m.label),
    weeksRange: `${f(weeks[0].start)} to ${f(lastSat)}`,
    monthKeys: months.map(m => m.key).join(', '),
    monthName: format(mStart, 'MMMM yyyy'),
    priorMonthName: format(priorStart, 'MMMM yyyy'),
    monthProgress: Math.min((mEnd.getDate()) / mEndFull.getDate(), 1)
  }
}

// Month-focused analysis: whole-month performance, month-over-month vs the
// prior month, and a concrete plan for next month. Outputs the four-section
// format the report page renders.
function monthlyAnalysisPrompt(w: any, pd: any, goals: any): string {
  const a1 = pd.A1 || {}, a2 = pd.A2 || {}
  const mom = (c: number, p: number) => p ? Math.round(((c - p) / p) * 100) : 0
  const goalsBlock = goals ? `\nGOALS FOR THE MONTH: ${JSON.stringify(goals).slice(0, 1200)}` : ''
  return `Senior analyst writing the ${w.monthName} MONTHLY report for the Ruff Liners TikTok Shop CEO. Be direct, specific, use real numbers.

THIS MONTH (${w.dataWindow}): GMV $${a1.gmv||0}, Orders ${a1.orders||0}, Videos ${a1.videos||0}, Views ${a1.views||0}, Creators ${a1.creators||0}, New ${a1.newCreators||0}, Retention ${a1.retention||0}%
PRIOR MONTH (${w.priorMonthName}): GMV $${a2.gmv||0} (${mom(a1.gmv||0,a2.gmv||0)>0?'+':''}${mom(a1.gmv||0,a2.gmv||0)}% MoM), Orders ${a2.orders||0}, Videos ${a2.videos||0}, Creators ${a2.creators||0}
GMV Max: Spend $${pd.A6?.spend||0}, Revenue $${pd.A6?.revenue||0}, ROI ${pd.A6?.roi||0}x${goalsBlock}
FULL DATA: ${JSON.stringify(pd).slice(0, 9000)}

Write 4 sections:
1. "performance" (3-4 paragraphs): the month's headline numbers, month-over-month comparison vs ${w.priorMonthName} (what improved, what declined, why), progress vs the month's goals if provided, what drove results — name the creators/products/levels moving the numbers.
2. "creators" (2-3 paragraphs): breakout creators this month, top content, which level was most active and most productive per creator, level mix shifts vs prior month.
3. "recruiting" (2-3 paragraphs): outreach results for the month (messages, samples, by level), what converted, reactivation targets, how the recruiting mix should change.
4. "growth" (3-4 paragraphs): THE PLAN FOR NEXT MONTH — 3-5 concrete prioritized actions with expected impact, informed by this month's week-over-week arc and the 6-month trajectory. Include 1-2 risks to monitor and an upside/downside GMV outlook for next month.

Output ONLY: {"performance":"para1\\n\\npara2","creators":"para1\\n\\npara2","recruiting":"para1\\n\\npara2","growth":"para1\\n\\npara2"}`
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
    prompt: w => BASE(w) + `\n\nQuery two things for ${w.d30.start}–${w.d30.end}:\n1) From creator_store_performance: affiliate GMV (store gmv), orders, videos posted, views, total creators who posted, new creators (first-ever post for this store), retention rate.\n2) Call get_dashboard_performance_overview for the same window. The response contains: totalShopGMV (map → shopGmv), totalShopGMVDifference (map → shopGmvPct), totalAffiliateGMV (map → affiliateGmv), totalAffiliateGMVDifference (map → affiliateGmvPct). GUARDRAIL: only populate shopGmv/affiliateGmv if shopGmvError === null AND gmvFiltered === false AND filteredGmvUnavailable === false; otherwise set both to 0.\nOutput: {"A1":{"gmv":0,"shopGmv":0,"shopGmvPct":0,"affiliateGmv":0,"affiliateGmvPct":0,"orders":0,"videos":0,"views":0,"creators":0,"newCreators":0,"retention":0}}`
  },
  2: {
    label: 'Pulling prior 30-day KPIs…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Prior 30d (${w.prior.start}–${w.prior.end}) totals: total GMV, orders, videos posted, views, total creators who posted, new creators (first-ever post for this store), retention rate.\nOutput: {"A2":{"gmv":0,"orders":0,"videos":0,"views":0,"creators":0,"newCreators":0,"retention":0}}`
  },
  3: {
    label: 'Pulling creator tier breakdown…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Current 30d (${w.d30.start}–${w.d30.end}) by creator level — pull every creator from creator_store_performance who posted in this window, classify each by their global gmv_30d (L1 <$5K, L2 $5K–$25K, L3 $25K–$60K, L4 $60K–$150K, L5 $150K–$400K, L6 $400K–$1.5M, L7 $1.5M+), then sum: creators who posted, new creators, videos posted, total views, and STORE GMV (the same gmv field from creator_store_performance, NOT global GMV). L1+…+L7 store GMV must sum to the overall 30d total. Total views must also sum to approximately the overall 30d total views — do not leave views as 0. Once you have the data, output ONLY the JSON — no analysis, no explanation.\nReturn ONLY: {"A3":{"l1":{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0},"l2":{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0},"l3":{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0},"l4":{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0},"l5":{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0},"l6":{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0},"l7":{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}}}`
  },
  4: {
    label: 'Pulling current outreach data…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Current 30d (${w.d30.start}–${w.d30.end}) outreach totals + by creator level (L1–L7, same thresholds as A3): messages sent, samples shipped.\nOutput: {"A4":{"total":{"msgs":0,"samples":0},"l1":{"msgs":0,"samples":0},"l2":{"msgs":0,"samples":0},"l3":{"msgs":0,"samples":0},"l4":{"msgs":0,"samples":0},"l5":{"msgs":0,"samples":0},"l6":{"msgs":0,"samples":0},"l7":{"msgs":0,"samples":0}}}`
  },
  5: {
    label: 'Pulling prior outreach data…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Prior 30d (${w.prior.start}–${w.prior.end}) outreach totals + by creator level (L1–L7, same thresholds as A3): messages sent, samples shipped.\nOutput: {"A5":{"total":{"msgs":0,"samples":0},"l1":{"msgs":0,"samples":0},"l2":{"msgs":0,"samples":0},"l3":{"msgs":0,"samples":0},"l4":{"msgs":0,"samples":0},"l5":{"msgs":0,"samples":0},"l6":{"msgs":0,"samples":0},"l7":{"msgs":0,"samples":0}}}`
  },
  6: {
    label: 'Pulling GMV Max data…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: GMV Max current 30d (${w.d30.start}–${w.d30.end}): (1) TOTAL account-level ad spend, attributed revenue, blended ROI — use get_dashboard_ads_overview which includes ALL content types (affiliate videos, product cards, in-house content), NOT just affiliate videos; (2) ad spend and ROI broken down by creator level for affiliate videos only (classify each video's creator by global gmv_30d: L1 <$5K, L2 $5K–$25K, L3 $25K–$60K, L4 $60K–$150K, L5 $150K–$400K, L6 $400K–$1.5M, L7 $1.5M+). Use 0 for all if data unavailable before May 14 2026.\nOutput: {"A6":{"spend":0,"revenue":0,"roi":0,"l1":{"spend":0,"roi":0},"l2":{"spend":0,"roi":0},"l3":{"spend":0,"roi":0},"l4":{"spend":0,"roi":0},"l5":{"spend":0,"roi":0},"l6":{"spend":0,"roi":0},"l7":{"spend":0,"roi":0}}}`
  },
  7: {
    label: 'Pulling GMV Max content age…',
    mcp: true,
    optional: true,
    prompt: w => BASE(w) + `\n\nQuery: GMV Max spend current 30d (${w.d30.start}–${w.d30.end}) broken down by content age. Use get_dashboard_ads_overview or query_store_data to pull GMV Max video-level data (each video's spend, revenue, publish_date). Then bucket each video by how old it was on ${w.d30.end}: "< 30 days" (publish_date >= ${w.d30.start}), "1–2 months" (31–60 days before ${w.d30.end}), "2–3 months" (61–90 days), "3–5 months" (91–150 days), "5+ months" (151+ days), "Unknown post date" (publish_date missing). Aggregate per bucket: videos (count), spend (sum), revenue (sum), roi (revenue/spend, 0 if no spend), pct (spend as % of total spend). Omit empty buckets. If the data is unavailable or the query fails output [].\nOutput: {"A7":[{"label":"< 30 days","videos":0,"spend":0,"revenue":0,"roi":0,"pct":0}]}`
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
OUTREACH (agentType="outreach"), searchQuery = "", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "Video Volume", "GMV Contest", "New Agent"
CRM (agentType="crm"), searchQuery = "", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "New Agent", "Video Volume", "GMV Contest", "Tiktoktshopbonus"

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
OUTREACH (agentType="outreach"), searchQuery = "", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "Video Volume", "GMV Contest", "New Agent"
CRM (agentType="crm"), searchQuery = "", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "New Agent", "Video Volume", "GMV Contest", "Tiktoktshopbonus"

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
    prompt: w => BASE(w) + `\n\nQuery: Weekly creators, new creators, videos posted, views, store GMV by creator level (L1 <$5K, L2 $5K–$25K, L3 $25K–$60K, L4 $60K–$150K, L5 $150K–$400K, L6 $400K–$1.5M, L7 $1.5M+) for all 13 weeks in ${w.weeksRange}. Return 13 rows per level. Views must be populated — each week's L1+…+L7 views should sum to approximately the week's total views (do not leave views as 0 if total views exist).\nOutput (exactly 13 items per array): {"C2":{"l1":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}],"l2":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}],"l3":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}],"l4":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}],"l5":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}],"l6":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}],"l7":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}]}}`
  },
  14: {
    label: 'Pulling 13-week retention & video trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Weekly retention rate + total videos posted + total views for all 13 weeks in ${w.weeksRange}.\nOutput (exactly 13 items): {"C3":[0],"C4":[{"videos":0,"views":0}]}`
  },
  15: {
    label: 'Pulling 13-week outreach trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Weekly messages sent + samples shipped by creator level (L1–L7, same thresholds as A3) for all 13 weeks in ${w.weeksRange}.\nOutput (exactly 13 items per array): {"C5":{"l1":[{"msgs":0,"samples":0}],"l2":[{"msgs":0,"samples":0}],"l3":[{"msgs":0,"samples":0}],"l4":[{"msgs":0,"samples":0}],"l5":[{"msgs":0,"samples":0}],"l6":[{"msgs":0,"samples":0}],"l7":[{"msgs":0,"samples":0}]}}`
  },
  16: {
    label: 'Pulling 6-month GMV trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nFor each of the 6 months query two metrics. Month date ranges: ${w.months.map((m: any) => `${m.key}: ${format(m.start,'yyyy-MM-dd')}–${format(m.end,'yyyy-MM-dd')}`).join(', ')}. IMPORTANT: for the current partial month (${w.months[5].key}) use the full range ${w.currentMonthStart}–${w.currentMonthEnd} — do NOT cap at ${w.d30.end}.\n1) affiliate GMV (gmv) + views from creator_store_performance for each month's exact date range.\n2) For each month call get_dashboard_performance_overview. Map totalShopGMV → shopGmv (total/account GMV including product cards). GUARDRAIL: set shopGmv to 0 for any month where shopGmvError is non-null or gmvFiltered/filteredGmvUnavailable is true.\nReturn 6 rows chronological.\nOutput (exactly 6 items): {"D1":[{"gmv":0,"shopGmv":0,"views":0}]}`
  },
  17: {
    label: 'Pulling 6-month creator trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Monthly creators, new creators, videos, views, store GMV by creator level (L1–L7, same thresholds as A3) for months ${w.monthKeys}. Return 6 rows per level.\nOutput (exactly 6 items per array): {"D2":{"l1":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}],"l2":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}],"l3":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}],"l4":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}],"l5":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}],"l6":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}],"l7":[{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}]}}`
  },
  18: {
    label: 'Pulling 6-month retention & outreach…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Monthly retention rate + outreach (messages sent + samples shipped by creator level L1–L7, same thresholds as A3) for months ${w.monthKeys}.\nOutput (exactly 6 items per array): {"D3":[0],"D4":{"l1":[{"msgs":0,"samples":0}],"l2":[{"msgs":0,"samples":0}],"l3":[{"msgs":0,"samples":0}],"l4":[{"msgs":0,"samples":0}],"l5":[{"msgs":0,"samples":0}],"l6":[{"msgs":0,"samples":0}],"l7":[{"msgs":0,"samples":0}]}}`
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


function assemble(w: ReturnType<typeof buildWindows>, pd: any, analysis: any) {
  const a1=pd.A1||{}, a2=pd.A2||{}, a3=pd.A3||{}, a4=pd.A4||{total:{}}, a5=pd.A5||{total:{}}, a6=pd.A6||{}
  const pct=(c:number,p:number)=>p?Math.round(((c-p)/p)*100):0
  const delta=(c:number,p:number)=>Math.round((c-p)*10)/10
  const LVLS=['l1','l2','l3','l4','l5','l6','l7'] as const
  const c1=pd.C1||[], c2=pd.C2||{}, c3=pd.C3||[], c4=pd.C4||[], c5=pd.C5||{}
  const d1=pd.D1||[], d2=pd.D2||{}, d3=pd.D3||[], d4=pd.D4||{}
  const mkTier=(lk:string)=>({
    creators:a3[lk]?.creators||0,newCreators:a3[lk]?.newCreators||0,videos:a3[lk]?.videos||0,views:a3[lk]?.views||0,gmv:a3[lk]?.gmv||0,
    gmvMaxSpend:a6[lk]?.spend||undefined,gmvMaxRoi:a6[lk]?.roi||undefined,
    msgs:a4[lk]?.msgs||0,msgsPct:pct(a4[lk]?.msgs||0,a5[lk]?.msgs||0),
    samples:a4[lk]?.samples||0,samplesPct:pct(a4[lk]?.samples||0,a5[lk]?.samples||0)
  })
  return {
    report_date:w.reportDate, label:w.label, data_window:w.dataWindow,
    d30:{
      gmv:a1.gmv||0, gmvPct:pct(a1.gmv||0,a2.gmv||0),
      shopGmv:a1.shopGmv||undefined, affiliateGmv:a1.affiliateGmv||undefined, affiliateGmvPct:a1.affiliateGmvPct||undefined,
      orders:a1.orders||0, ordersPct:pct(a1.orders||0,a2.orders||0),
      videos:a1.videos||0, videosPct:pct(a1.videos||0,a2.videos||0), views:a1.views||0, viewsPct:pct(a1.views||0,a2.views||0),
      creators:a1.creators||0, creatorsPct:pct(a1.creators||0,a2.creators||0), newCreators:a1.newCreators||0, newCreatorsPct:pct(a1.newCreators||0,a2.newCreators||0),
      retention:a1.retention||0, retentionDelta:delta(a1.retention||0,a2.retention||0),
      gmvMax:{spend:a6.spend||0,revenue:a6.revenue||0,roi:a6.roi||0},
      gmvMaxByAge:(pd.A7&&pd.A7.length>0)?sanitizeRows(pd.A7):undefined,
      msgs:a4.total?.msgs||0, msgsPct:pct(a4.total?.msgs||0,a5.total?.msgs||0),
      samples:a4.total?.samples||0, samplesPct:pct(a4.total?.samples||0,a5.total?.samples||0),
      tiers:Object.fromEntries(LVLS.map(lk=>[lk,mkTier(lk)])) as any
    },
    weekly_charts:{
      labels:w.weekLabels, gmv:c1.map((r:any)=>r.gmv||0), views:c4.map((r:any)=>r.views||0),
      ...Object.fromEntries(LVLS.map(lk=>[`crl${lk[1]}`,c2[lk]?.map((r:any)=>r.creators||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`ncl${lk[1]}`,c2[lk]?.map((r:any)=>r.newCreators||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`vl${lk[1]}`,c2[lk]?.map((r:any)=>r.videos||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`gl${lk[1]}`,c2[lk]?.map((r:any)=>r.gmv||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`vwl${lk[1]}`,c2[lk]?.map((r:any)=>r.views||0)||[]])),
      ret:c3.map((r:any)=>typeof r==='number'?r:0), vid:c4.map((r:any)=>r.videos||0),
      ...Object.fromEntries(LVLS.map(lk=>[`ml${lk[1]}`,c5[lk]?.map((r:any)=>r.msgs||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`sl${lk[1]}`,c5[lk]?.map((r:any)=>r.samples||0)||[]]))
    },
    monthly_charts:{
      labels:w.monthLabels, gmv:d1.map((r:any)=>r.gmv||0), totalGmv:d1.every((r:any)=>!r.shopGmv)?undefined:d1.map((r:any)=>r.shopGmv||0), views:d1.map((r:any)=>r.views||0),
      ...Object.fromEntries(LVLS.map(lk=>[`crl${lk[1]}`,d2[lk]?.map((r:any)=>r.creators||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`ncl${lk[1]}`,d2[lk]?.map((r:any)=>r.newCreators||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`vl${lk[1]}`,d2[lk]?.map((r:any)=>r.videos||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`gl${lk[1]}`,d2[lk]?.map((r:any)=>r.gmv||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`vwl${lk[1]}`,d2[lk]?.map((r:any)=>r.views||0)||[]])),
      ret:d3.map((r:any)=>typeof r==='number'?r:0),
      ...Object.fromEntries(LVLS.map(lk=>[`ml${lk[1]}`,d4[lk]?.map((r:any)=>r.msgs||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`sl${lk[1]}`,d4[lk]?.map((r:any)=>r.samples||0)||[]]))
    },
    tables:sanitizeTables({topCreators:pd.topCreators||[], topVideos:pd.topVideos||[], activeCreators:pd.activeCreators||[]}),
    agents:pd.agents||[],
    analysis: analysis?.performance !== undefined
      ? analysis
      : { d30:analysis?.d30||'', weekly:analysis?.weekly||'', monthly:analysis?.monthly||'' }
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

async function callClaude(prompt: string, apiKey: string, withMcp: boolean, maxTokens = 8000, model = EXTRACT_MODEL): Promise<string> {
  const body: any = { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }
  if (withMcp) {
    const raw = (process.env.EUKA_BEARER_TOKEN||'').trim()
    const tok = raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw
    const srv: any = { type: 'url', url: process.env.EUKA_MCP_URL!, name: 'euka' }
    if (tok) srv.authorization_token = tok
    body.mcp_servers = [srv]
  }

  // MCP call: 680s. Non-MCP (analysis): 300s. Agents: 750s (complex multi-step enumeration).
  const timeoutMs = withMcp ? (maxTokens > 4000 ? 750_000 : 680_000) : 300_000

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

  // If no JSON in the response, send a follow-up turn (no MCP needed, 90s is plenty).
  // Replay only text blocks — a truncated response can end in an mcp_tool_use
  // without its mcp_tool_result, which the API rejects as an invalid transcript.
  if (text.indexOf('{') === -1) {
    console.warn('No JSON in first response, sending JSON-coerce follow-up turn')
    const textBlocks = (data.content || []).filter((b: any) => b.type === 'text')
    const followUpBody: any = {
      model,
      max_tokens: 2000,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: textBlocks.length ? textBlocks : [{ type: 'text', text: '(tool activity elided)' }] },
        { role: 'user', content: 'Now output ONLY the JSON object with the exact structure I specified. Start your response with { and end with }. Nothing else. Use the data you already pulled; use 0 for anything you could not retrieve.' }
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

// ── Parallel phase orchestration ────────────────────────────────────────────
// Per-phase state lives in phase_data._ph: { [phase]: { s, t, a } } where
// s = 'run' | 'done' | 'retry', t = start epoch ms, a = attempts so far.
// Data phases (1-18 weekly, 1-11 live) are independent Euka pulls and run
// concurrently; analysis (19) needs all data; save (20) needs analysis.
const MAX_PHASE_ATTEMPTS = 3
// A run-marked phase younger than this is treated as still executing; older
// means its runner died (deploy, crash, platform kill) and it may be re-claimed
const IN_FLIGHT_MS = 10 * 60 * 1000

const dataPhasesFor = (isLive: boolean) =>
  Array.from({ length: isLive ? 11 : 18 }, (_, i) => i + 1)

// Jobs created before parallel orchestration tracked progress via the phase
// counter + label suffixes; derive _ph from that so they resume seamlessly.
function seedPhaseState(job: any): any {
  const existing = job.phase_data?._ph
  if (existing) return existing
  const ph: any = {}
  const started = job.phase || 0
  const ended = /done|unavailable|complete|✓/i.test(job.phase_label || '')
  for (let p = 1; p < started; p++) ph[p] = { s: 'done' }
  if (started > 0) ph[started] = ended
    ? { s: 'done' }
    : { s: 'run', t: new Date(job.updated_at).getTime(), a: 1 }
  return ph
}

// Optimistic-concurrency update: concurrent phases finish at overlapping times
// and each writes the whole phase_data blob, so merge against the fresh row
// and retry when another writer got in between (updated_at acts as version).
async function casUpdate(supabase: any, jobId: string, mutate: (row: any) => any | null): Promise<any> {
  for (let i = 0; i < 8; i++) {
    const { data: row } = await supabase.from('report_jobs').select('*').eq('id', jobId).single()
    if (!row) throw new Error('Job not found during update')
    const fields = mutate(row)
    if (!fields) return row
    const { data: won } = await supabase.from('report_jobs')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', jobId).eq('updated_at', row.updated_at)
      .select('id')
    if (won && won.length) return { ...row, ...fields }
    await new Promise(r => setTimeout(r, 200 + Math.floor(Math.random() * 400)))
  }
  throw new Error('Job update conflict — too many concurrent writers')
}

async function finalizeLive(supabase: any, jobId: string, pd: any, w: ReturnType<typeof buildWindows>) {
  const fullReport = assemble(w, pd, { d30: '', weekly: '', monthly: '' })
  // Live snapshots flag inconsistencies rather than re-pulling — the user can
  // simply refresh again, and the banner makes the state visible meanwhile
  const reconWarnings = reconcileD30(fullReport.d30)
  if (reconWarnings.length) (fullReport.d30 as any).reconciliation = reconWarnings
  const liveData = {
    report_date: fullReport.report_date,
    label: fullReport.label,
    data_window: fullReport.data_window,
    d30: fullReport.d30,
    tables: fullReport.tables,
    agents: fullReport.agents,
    analysis: { d30: '' },
  }
  await supabase.from('app_config').upsert({ key: 'live_report', value: JSON.stringify(liveData) }, { onConflict: 'key' })
  await supabase.from('report_jobs').update({ status: 'done', phase_label: 'Done ✓', updated_at: new Date().toISOString() }).eq('id', jobId)
}

// Merge a finished phase's data into the row and advance the progress counter.
// Returns the merged row so live jobs can detect "all data phases landed".
async function finishPhase(supabase: any, jobId: string, target: number, delta: any, isLive: boolean) {
  const dataPhases = dataPhasesFor(isLive)
  const totalSteps = isLive ? dataPhases.length : dataPhases.length + 2
  return casUpdate(supabase, jobId, (row: any) => {
    const curPd = row.phase_data || {}
    const curPh = curPd._ph || {}
    const newPh = { ...curPh, [target]: { ...(curPh[target] || {}), s: 'done' } }
    const doneSteps = dataPhases.filter(p => newPh[p]?.s === 'done').length
      + (!isLive && newPh[19]?.s === 'done' ? 1 : 0)
      + (!isLive && newPh[20]?.s === 'done' ? 1 : 0)
    return {
      phase_data: { ...curPd, ...delta, _ph: newPh },
      phase: doneSteps,
      phase_label: `${doneSteps}/${totalSteps} done`
    }
  })
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
  if (job.status === 'done') return NextResponse.json({ ok: true, done: true })
  if (job.status === 'error') return NextResponse.json({ ok: false, error: job.error }, { status: 500 })

  const apiKey = await getAnthropicKey()
  if (!apiKey) {
    await supabase.from('report_jobs').update({ status:'error', error:'Anthropic API key not configured', updated_at:new Date().toISOString() }).eq('id',jobId)
    return NextResponse.json({ error: 'API key not configured' }, { status: 503 })
  }

  const params = job.params || {}
  const today = params.today ? new Date(params.today) : new Date()
  const isLive = job.job_type === 'live_refresh'
  const isMonthly = job.job_type === 'monthly_report'
  const w: any = isMonthly
    ? buildMonthlyWindows(params.month || format(subDays(today, 2), 'yyyy-MM'), today)
    : buildWindows(today)
  const dataPhases = dataPhasesFor(isLive)

  // Terminal-step recovery: everything pulled but the final write never landed
  const snap = seedPhaseState(job)
  if (dataPhases.every(p => snap[p]?.s === 'done')) {
    if (isLive) {
      await finalizeLive(supabase, jobId, job.phase_data || {}, w)
      return NextResponse.json({ ok: true, done: true })
    }
    if (snap[20]?.s === 'done') {
      await supabase.from('report_jobs').update({ status:'done', phase_label:'Complete ✓', updated_at:new Date().toISOString() }).eq('id',jobId)
      return NextResponse.json({ ok: true, done: true })
    }
  }

  // Claim the next ready phase. The pick happens inside the CAS mutate on the
  // fresh row, so concurrent kicks claim different phases instead of racing.
  let target = 0
  let attempts = 1
  await casUpdate(supabase, jobId, (row: any) => {
    const curPd = row.phase_data || {}
    const curPh = curPd._ph || seedPhaseState(row)
    const now = Date.now()
    const done = (p: number) => curPh[p]?.s === 'done'
    const fresh = (p: number) => curPh[p]?.s === 'run' && now - (curPh[p]?.t || 0) < IN_FLIGHT_MS
    const ready = dataPhases.filter(p => !done(p) && !fresh(p))
    if (!isLive && dataPhases.every(done)) {
      if (!done(19) && !fresh(19)) ready.push(19)
      else if (done(19) && !done(20) && !fresh(20)) ready.push(20)
    }
    if (!ready.length) { target = 0; return null }
    target = ready[0]
    attempts = (curPh[target]?.a || 0) + 1
    return {
      status: 'running',
      phase_data: { ...curPd, _ph: { ...curPh, [target]: { s: 'run', t: now, a: attempts } } },
      phase_label: PHASES[target].label
    }
  })

  if (!target) {
    // every remaining phase is already being executed by another runner
    return NextResponse.json({ ok: true, running: true })
  }

  const phaseConfig = PHASES[target]

  // The phase itself can run 5-12 minutes — far longer than browsers keep a
  // request open — so it executes detached from this response (after() runs
  // to the route's maxDuration) and clients poll the job row for progress.
  after(async () => {
  try {
    if (target === 19 || target === 20) {
      // These need the full accumulated data — read it fresh, all data
      // phases have landed by the time they are claimable
      const { data: row } = await supabase.from('report_jobs').select('phase_data').eq('id', jobId).single()
      const pd = { ...(row?.phase_data || {}) }

      if (target === 19) {
        // Monthly reports get a month-over-month analysis with a next-month
        // plan, written by the strongest configured model
        let goalsSnap: any = null
        try {
          const { data: g } = await supabase.from('app_config').select('value').eq('key','goals').single()
          if (g?.value) goalsSnap = JSON.parse(g.value)
        } catch { /* analysis runs without goals context */ }
        const analysisPrompt = isMonthly
          ? monthlyAnalysisPrompt(w, pd, goalsSnap)
          : phaseConfig.prompt(w, pd)
        const text = await callClaude(analysisPrompt, apiKey, false, 8000, ANALYSIS_MODEL)
        await finishPhase(supabase, jobId, 19, extractJson(text), isLive)
        return
      }

      // Phase 20 — assemble and save
      const analysis = isMonthly
        ? { performance: pd.performance||'', creators: pd.creators||'', recruiting: pd.recruiting||'', growth: pd.growth||'' }
        : { d30: pd.d30||'', weekly: pd.weekly||'', monthly: pd.monthly||'' }
      // Fallback: if agents weren't fetched in Phase 8, pull from most recent live_report
      if (!pd.agents || pd.agents.length === 0) {
        try {
          const { data: liveConfig } = await supabase.from('app_config').select('value').eq('key','live_report').single()
          if (liveConfig?.value) {
            const lr = typeof liveConfig.value === 'string' ? JSON.parse(liveConfig.value) : liveConfig.value
            if (lr?.agents?.length > 0) pd.agents = lr.agents
          }
        } catch { /* ignore — report saves without agents */ }
      }
      const report = assemble(w, pd, analysis)

      // Auto-reconcile before saving: if level breakdowns don't match the
      // headline totals, re-pull the phases those numbers came from (and
      // re-write the analysis) instead of saving inconsistent data. One
      // repair round; a persistent mismatch saves with a visible warning.
      const reconWarnings = reconcileD30(report.d30)
      if (reconWarnings.length) {
        const retried = Number(pd._reconRetries || 0)
        const redo = new Set<number>()
        for (const wng of reconWarnings) {
          if (wng.startsWith('GMV:') || wng.startsWith('Views:')) { redo.add(1); redo.add(3) }
          if (wng.startsWith('Messages:') || wng.startsWith('Samples:')) redo.add(4)
          if (wng.startsWith('GMV Max spend:')) redo.add(7)
        }
        if (retried < 1 && redo.size) {
          console.warn(`Job ${jobId}: reconciliation failed, re-pulling phases ${[...redo].join(',')}:`, reconWarnings)
          await casUpdate(supabase, jobId, (row: any) => {
            const curPd = row.phase_data || {}
            const newPh = { ...(curPd._ph || {}) }
            for (const p of redo) newPh[p] = { s: 'retry', a: 0 }
            newPh[19] = { s: 'retry', a: 0 } // analysis quotes the numbers — rewrite it
            newPh[20] = { s: 'retry', a: 0 } // this save attempt; re-claimable once data lands
            return {
              phase_data: { ...curPd, _reconRetries: retried + 1, _ph: newPh },
              phase_label: 'Numbers did not reconcile — re-pulling data…'
            }
          })
          return
        }
        ;(report.d30 as any).reconciliation = reconWarnings
      }

      if (isMonthly) {
        ;(report.d30 as any).reportType = 'monthly'
        ;(report.d30 as any).monthProgress = w.monthProgress
        ;(report.d30 as any).windowEnd = w.d30.end
      }
      // Snapshot the goals in effect this month into the report so past
      // reports keep showing the targets (and results) of their own month
      try {
        const { data: g } = await supabase.from('app_config').select('value').eq('key','goals').single()
        if (g?.value) (report.d30 as any).goals = JSON.parse(g.value)
      } catch { /* report saves without goals snapshot */ }
      await supabase.from('weekly_reports').upsert(report, { onConflict:'report_date' })
      // Keep the Live 30 Day page in sync with weekly reports — a monthly
      // report's window is the calendar month, not the trailing 30 days
      if (!isMonthly) {
        const liveData = {
          report_date: report.report_date,
          label: report.label,
          data_window: report.data_window,
          d30: report.d30,
          tables: report.tables,
          agents: report.agents,
          analysis: { d30: report.analysis?.d30 || '' },
        }
        await supabase.from('app_config').upsert({ key:'live_report', value: JSON.stringify(liveData) }, { onConflict:'key' })
      }
      await supabase.from('report_jobs').update({ status:'done', phase:20, phase_label:'Complete ✓', updated_at:new Date().toISOString() }).eq('id',jobId)
      return
    }

    // Data phase — independent Euka pull, needs no prior phase data
    let delta: any
    const activePrompt = phaseConfig.promptLive
      ? phaseConfig.promptLive(w, {})
      : phaseConfig.prompt(w, {})
    try {
      const text = await callClaude(activePrompt, apiKey, phaseConfig.mcp, phaseConfig.maxTokens)
      if (phaseConfig.isAgents) {
        // Agents response is a JSON array; extract it directly
        const start = text.indexOf('['), end = text.lastIndexOf(']')
        let agents: any[] = []
        if (start !== -1 && end !== -1) {
          try { agents = JSON.parse(text.slice(start, end + 1)) } catch { agents = [] }
        }
        delta = { agents }
      } else {
        try {
          delta = extractJson(text)
        } catch {
          const preview = text.slice(0, 600)
          console.error(`Phase ${target} non-JSON response:`, preview)
          throw new Error(`No JSON in Claude response (phase ${target}). Claude said: ${preview}`)
        }
      }
    } catch (e: any) {
      if (!phaseConfig.optional) throw e
      // Optional phase failed — record the error, continue with defaults
      const errMsg = e?.message?.slice(0,400) || 'unknown error'
      console.warn(`Optional phase ${target} skipped: ${errMsg}`)
      delta = { [`_phase${target}Error`]: errMsg }
      if (phaseConfig.isAgents) delta.agents = []
    }

    const merged = await finishPhase(supabase, jobId, target, delta, isLive)

    // live_refresh: when the last data phase lands, write the live snapshot.
    // Writes to app_config key 'live_report' — never touches weekly_reports.
    if (isLive) {
      const phNow = merged.phase_data?._ph || {}
      if (dataPhases.every(p => phNow[p]?.s === 'done')) {
        await finalizeLive(supabase, jobId, merged.phase_data, w)
      }
    }

  } catch (err: any) {
    const msg = err?.message||'Unknown error'
    console.error(`Job ${jobId} phase ${target}:`, msg)
    // Transient failures (slow MCP pull timing out, Anthropic overloaded)
    // get the phase re-run by the next kick instead of killing the job
    const transient = /timeout|unreachable|overloaded|Claude API 5\d\d|mcp_tool_result/i.test(msg)
    if (transient && attempts < MAX_PHASE_ATTEMPTS) {
      await casUpdate(supabase, jobId, (row: any) => {
        const curPd = row.phase_data || {}
        const curPh = curPd._ph || {}
        return {
          phase_data: { ...curPd, _ph: { ...curPh, [target]: { ...(curPh[target] || {}), s: 'retry' } } },
          phase_label: `${phaseConfig.label.replace(/…$/,'')} — retrying (attempt ${attempts + 1} of ${MAX_PHASE_ATTEMPTS})`
        }
      }).catch(() => {})
      return
    }
    await supabase.from('report_jobs').update({ status:'error', error:msg.slice(0,500), updated_at:new Date().toISOString() }).eq('id',jobId)
  }
  })

  return NextResponse.json({ ok: true, started: target })
}
