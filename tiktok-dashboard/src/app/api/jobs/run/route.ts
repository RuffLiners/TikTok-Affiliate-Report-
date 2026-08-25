import { NextRequest, NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { reconcileD30 } from '@/lib/reconcile'
import { sanitizeRows, sanitizeTables } from '@/lib/sanitize'
import { CANONICAL_METRIC_DEFS, PROMPT_VERSION } from '@/lib/canonicalDefs'
import { validateGeneratedReport, phasesForIssue } from '@/lib/validateReport'
import { collectReviewFlags, splitReviewed, tierDefinitionNote } from '@/lib/sanityDiff'
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

// Every report date — window boundaries, Sun–Sat weeks, months — is defined in
// America/Los_Angeles. Vercel runs in UTC, so deriving "today" from the raw
// clock shifts every boundary one day forward for evening runs; shift to LA
// first. An explicit params.today (YYYY-MM-DD) is already a calendar date.
const REPORT_TZ = 'America/Los_Angeles'
function todayInReportTz(param?: string): Date {
  if (param) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(param)
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return new Date(param)
  }
  return new Date(new Date().toLocaleString('en-US', { timeZone: REPORT_TZ }))
}

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
RULES: Always specify year 2026 in queries. Read every CSV with read_sandbox_file. Use creator_store_performance for GMV. GMV Max only from May 14 2026 (use 0 if earlier). ALL date bucketing — video publish dates, Sun–Sat week boundaries, month boundaries, message dates, sample request dates — uses America/Los_Angeles, NEVER UTC.
${CANONICAL_METRIC_DEFS}
CRITICAL OUTPUT RULE: You MUST respond with ONLY a single JSON object. No explanations, no analysis, no markdown, no prose before or after. Your entire response must start with { and end with }. Fill in real numbers from the data.`

// ONE query per phase — each phase is one Vercel function call (maxDuration=800)
const PHASES: Record<number, { label: string; prompt: (w: ReturnType<typeof buildWindows>, pd: any) => string; promptLive?: (w: ReturnType<typeof buildWindows>, pd: any) => string; mcp: boolean; isAgents?: boolean; maxTokens?: number; optional?: boolean }> = {
  1: {
    label: 'Pulling current 30-day KPIs…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery two things for ${w.d30.start}–${w.d30.end}:\n1) From creator_store_performance, per the canonical definitions:\n- affiliate GMV = SUM(gmv); orders = SUM(items_sold_count) ALL attribution; views = SUM(impressions) — each over EVERY row dated in the window.\n- creators = DISTINCT handles that POSTED at least one NEW video during the window (video publish date inside the window, America/Los_Angeles). A handle whose rows only carry GMV/views from videos posted before the window does NOT count. Dedup by handle before counting — the creators table has duplicate-handle rows. Handles with NO match in the creators dimension (no gmv_30d) STILL COUNT — never drop them (do not INNER JOIN to the creators table for counting).\n- videos = count of videos published inside the window, deduped by video id — duplicate creator rows must not double-count videos, and videos from handles missing in the creators dimension STILL COUNT.\n- new creators = handles whose first-ever post for this store falls inside the window.\n- retention = (distinct handles that posted in BOTH the prior window and this window) ÷ (distinct handles that posted in the prior window), expressed as a PERCENT 0–100 with one decimal (e.g. 28.0) — NOT a fraction.\n2) Call get_dashboard_performance_overview for the same window. The response contains: totalShopGMV (map → shopGmv), totalShopGMVDifference (map → shopGmvPct), totalAffiliateGMV (map → affiliateGmv), totalAffiliateGMVDifference (map → affiliateGmvPct). GUARDRAIL: only populate shopGmv/affiliateGmv if shopGmvError === null AND gmvFiltered === false AND filteredGmvUnavailable === false; otherwise set both to 0.\nOutput: {"A1":{"gmv":0,"shopGmv":0,"shopGmvPct":0,"affiliateGmv":0,"affiliateGmvPct":0,"orders":0,"videos":0,"views":0,"creators":0,"newCreators":0,"retention":0}}`
  },
  2: {
    label: 'Pulling prior 30-day KPIs…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Prior 30d (${w.prior.start}–${w.prior.end}) totals, per the canonical definitions: affiliate GMV = SUM(gmv); orders = SUM(items_sold_count) ALL attribution; views = SUM(impressions); creators = DISTINCT handles that POSTED at least one NEW video inside the window (publish date in window; any-activity rows do NOT count; dedup by handle; handles missing from the creators dimension STILL COUNT — never drop them); videos = videos published inside the window deduped by video id (unmatched-handle videos still count); new creators = first-ever post falls in the window; retention = same formula shifted one window back, expressed as a PERCENT 0–100 (e.g. 28.0), NOT a fraction.\nOutput: {"A2":{"gmv":0,"orders":0,"videos":0,"views":0,"creators":0,"newCreators":0,"retention":0}}`
  },
  3: {
    label: 'Pulling creator tier breakdown…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Current 30d (${w.d30.start}–${w.d30.end}) by creator level. Apply the canonical TIER GMV rule exactly:\n- GMV and views per level cover EVERY creator_store_performance row in the window — including GMV/impressions from evergreen videos posted before the window and from creators who did not post in it. Do NOT restrict to videos posted in-window.\n- creators / new creators / videos per level count only creators who POSTED at least one NEW video inside the window (publish date in window — any-activity rows do NOT count); dedup by handle before joining levels, and dedup videos by video id.\n- Levels from gmv_30d_num: L1 <$5K, L2 $5K–$25K, L3 $25K–$60K, L4 $60K–$150K, L5 $150K–$400K, L6 $400K–$1.5M, L7 $1.5M+; null or unmatched handle → L1. This unmatched→L1 rule applies to ALL metrics — creators, new creators, videos, views, AND gmv. Creators with no creators-dimension match are counted in L1, never dropped (use a LEFT JOIN, not an inner join).\nVERIFY BEFORE ANSWERING: request a totals row — L1+…+L7 GMV must equal the window's total affiliate GMV, L1+…+L7 views must equal total impressions, and L1+…+L7 creators/new creators/videos must equal the posted-creator totals. If any sum is off, re-run the query; never hand-patch numbers. Once verified, output ONLY the JSON — no analysis, no explanation.\nReturn ONLY: {"A3":{"l1":{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0},"l2":{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0},"l3":{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0},"l4":{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0},"l5":{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0},"l6":{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0},"l7":{"creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0}}}`
  },
  4: {
    label: 'Pulling current outreach data…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Current 30d (${w.d30.start}–${w.d30.end}) outreach totals + by creator level (L1–L7, same thresholds as A3): msgs = INITIAL outreach messages ONLY per the canonical MESSAGES rule (EXCLUDE follow-up messages, dedup by message id); samples = sample requests shipped, bucketed by the request's CREATED date (America/Los_Angeles).\nOutput: {"A4":{"total":{"msgs":0,"samples":0},"l1":{"msgs":0,"samples":0},"l2":{"msgs":0,"samples":0},"l3":{"msgs":0,"samples":0},"l4":{"msgs":0,"samples":0},"l5":{"msgs":0,"samples":0},"l6":{"msgs":0,"samples":0},"l7":{"msgs":0,"samples":0}}}`
  },
  5: {
    label: 'Pulling prior outreach data…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Prior 30d (${w.prior.start}–${w.prior.end}) outreach totals + by creator level (L1–L7, same thresholds as A3): msgs = INITIAL outreach messages ONLY per the canonical MESSAGES rule (EXCLUDE follow-up messages, dedup by message id); samples = sample requests shipped, bucketed by the request's CREATED date (America/Los_Angeles).\nOutput: {"A5":{"total":{"msgs":0,"samples":0},"l1":{"msgs":0,"samples":0},"l2":{"msgs":0,"samples":0},"l3":{"msgs":0,"samples":0},"l4":{"msgs":0,"samples":0},"l5":{"msgs":0,"samples":0},"l6":{"msgs":0,"samples":0},"l7":{"msgs":0,"samples":0}}}`
  },
  6: {
    label: 'Pulling GMV Max data…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: GMV Max current 30d (${w.d30.start}–${w.d30.end}): (1) spend, attributed revenue, and ROI from the GMV Max ad tables ONLY (video-level GMV Max spend/revenue summed over the window — the exact same source used for the content-age breakdown, so this header spend will equal the sum of the age-bucket spends). Do NOT use get_dashboard_ads_overview's totalAdSpend — it includes non-GMV-Max ad spend; (2) GMV Max spend and ROI broken down by creator level for affiliate videos (classify each video's creator by global gmv_30d: L1 <$5K, L2 $5K–$25K, L3 $25K–$60K, L4 $60K–$150K, L5 $150K–$400K, L6 $400K–$1.5M, L7 $1.5M+). Use 0 for all if data unavailable before May 14 2026.\nOutput: {"A6":{"spend":0,"revenue":0,"roi":0,"l1":{"spend":0,"roi":0},"l2":{"spend":0,"roi":0},"l3":{"spend":0,"roi":0},"l4":{"spend":0,"roi":0},"l5":{"spend":0,"roi":0},"l6":{"spend":0,"roi":0},"l7":{"spend":0,"roi":0}}}`
  },
  7: {
    label: 'Pulling GMV Max content age…',
    mcp: true,
    optional: true,
    prompt: w => BASE(w) + `\n\nQuery: GMV Max spend current 30d (${w.d30.start}–${w.d30.end}) broken down by content age. Use query_store_data to pull GMV Max video-level data (each video's spend, revenue, publish_date) from the GMV Max ad tables — the same source as the A6 header, so the buckets must sum to the header spend. Then bucket each video by how old it was on ${w.d30.end}: "< 30 days" (publish_date >= ${w.d30.start}), "1–2 months" (31–60 days before ${w.d30.end}), "2–3 months" (61–90 days), "3–5 months" (91–150 days), "5+ months" (151+ days), "Unknown post date" (publish_date missing). Aggregate per bucket: videos (count), spend (sum), revenue (sum), roi (revenue/spend, 0 if no spend), pct (spend as % of total spend). Omit empty buckets. If the data is unavailable or the query fails output [].\nOutput: {"A7":[{"label":"< 30 days","videos":0,"spend":0,"revenue":0,"roi":0,"pct":0}]}`
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
OUTREACH (agentType="outreach"), searchQuery = "", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "Video Volume", "GMV Contest", "New Agent", "Tiktoktshopbonus"
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
OUTREACH (agentType="outreach"), searchQuery = "", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "Video Volume", "GMV Contest", "New Agent", "Tiktoktshopbonus"
CRM (agentType="crm"), searchQuery = "", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "New Agent", "Video Volume", "GMV Contest", "Tiktoktshopbonus"

Merge all results → deduplicate by id → drop any agent with created_time older than ${startDate}.

Completeness guard: if any single searchQuery in-window count hits the 25-row cap AND that call's total > 25, add narrower date-string queries and repeat until no bucket is truncated.

## STEP 2 — Enrich
Fetch the campaign settings (target_gmvs, target_categories, other target_* fields, lists/segments/targeting_method, commission rates, has_followups, products) for ALL in-window agents with ONE batched query_store_data call over the outreach campaign settings table filtered to the collected ids (WHERE id IN (...)) — do NOT call get_outreach_agent once per agent. Fall back to get_outreach_agent(campaignId=id, storeId=${process.env.EUKA_STORE_ID}) ONLY for individual ids missing from the batched result.

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
    // eng = engagement RATE as a percent ((likes+comments+shares)/views×100),
    // never a raw interaction count — null when only counts are available
    prompt: w => BASE(w) + `\n\nQuery: Top 15 creators by store GMV (${w.d30.start}–${w.d30.end}): handle (h), followers (flw), store GMV in the window (sgmv), ggmv = the creator's GLOBAL gmv_30d_num from the creators dimension (their overall TikTok GMV, not this store's), views, v30 = videos posted in the window (publish dates in America/Los_Angeles), vmgmv, vlife = lifetime videos for this store, v7 = videos posted ${w.last7.start}–${w.last7.end}, orders, AOV, eng.\nvmgmv = the number of this creator's videos for THIS STORE that generated ANY GMV during the window REGARDLESS of when the video was posted — evergreen videos published before the window COUNT. Do NOT restrict vmgmv to videos posted inside the window (vmgmv is usually ≥ the in-window video count).\neng = engagement RATE as a percent ((likes+comments+shares) ÷ views × 100, e.g. 4.2). If the source only provides a raw interaction COUNT or no engagement data, output null — never a raw count.\nOutput: {"topCreators":[{"h":"","flw":0,"sgmv":0,"ggmv":0,"views":0,"v30":0,"vmgmv":0,"vlife":0,"v7":0,"ord":0,"aov":0,"eng":null}]}`
  },
  10: {
    label: 'Pulling top 15 videos…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Top 15 videos by store GMV (${w.d30.start}–${w.d30.end}): creator handle (h), ggmv, product name (shorten: "Hard Bottom Backseat Extenders for Dogs with Door Protection"→"Back Seat Ext.", "XL Floor Cover for Full-Size Crew Cab Trucks with Fold Up Seats"→"XL Floor Cover", "Travel Dog Bed for Car"→"Travel Dog Bed"), GMV, views, orders, AOV, publish date, likes, comments, product clicks.\nggmv = the CREATOR's global gmv_30d_num from the creators dimension (the creator's overall TikTok GMV) — it is NOT this video's gmv; the two columns must be different numbers. Never copy gmv into ggmv.\nOutput: {"topVideos":[{"h":"","ggmv":0,"prod":"","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":""}]}`
  },
  11: {
    label: 'Pulling most active creators…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Top 15 creators by videos posted (${w.d30.start}–${w.d30.end}): handle (h), ggmv, followers (flw), videos posted in the window (v30), GMV from those in-window videos (gmvN), total store GMV in the window (gmvT), total views, avg views per video, orders.\nggmv = the creator's GLOBAL gmv_30d_num from the creators dimension — the EXACT same column topCreators.ggmv uses. Do NOT use lifetime GMV, cumulative GMV, or any other aggregate.\nOutput: {"activeCreators":[{"h":"","ggmv":0,"flw":0,"v30":0,"gmvN":0,"gmvT":0,"views":0,"avgv":0,"ord":0}]}`
  },
  12: {
    label: 'Pulling 13-week GMV trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Weekly GMV + orders for all 13 Sun–Sat weeks in ${w.weeksRange}. Return 13 rows in chronological order.\nOutput (exactly 13 items): {"C1":[{"gmv":0,"orders":0}]}`
  },
  // The by-tier pulls are the heaviest queries in the pipeline — posting
  // counts and GMV/views run as separate phases so each fits one invocation
  13: {
    label: 'Pulling 13-week creator posting trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Weekly creators, new creators, videos posted by creator level (L1 <$5K, L2 $5K–$25K, L3 $25K–$60K, L4 $60K–$150K, L5 $150K–$400K, L6 $400K–$1.5M, L7 $1.5M+; null or unmatched handle → L1, never dropped — LEFT JOIN to the creators dimension) for all 13 Sun–Sat weeks in ${w.weeksRange} (America/Los_Angeles publish dates). Count only creators who POSTED in each week, deduped by handle before joining levels. Each week's L1+…+L7 creators/new creators/videos must equal that week's posted totals INCLUDING unmatched-handle creators — verify against a totals row and re-run if off. Return 13 rows per level.\nOutput (exactly 13 items per array): {"C2P":{"l1":[{"creators":0,"newCreators":0,"videos":0}],"l2":[{"creators":0,"newCreators":0,"videos":0}],"l3":[{"creators":0,"newCreators":0,"videos":0}],"l4":[{"creators":0,"newCreators":0,"videos":0}],"l5":[{"creators":0,"newCreators":0,"videos":0}],"l6":[{"creators":0,"newCreators":0,"videos":0}],"l7":[{"creators":0,"newCreators":0,"videos":0}]}}`
  },
  14: {
    label: 'Pulling 13-week retention & video trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: For all 13 Sun–Sat weeks in ${w.weeksRange} (America/Los_Angeles):\n1) Weekly retention rate — for each week: (distinct handles that posted in BOTH the prior week and that week) ÷ (distinct handles that posted in the prior week) × 100. C3 must be an array of 13 plain NUMBERS on the PERCENT scale (e.g. 38.1), NOT fractions (0.381) and NOT objects — a week with no data is 0, never null or {}.\n2) Weekly total videos posted (publish date in the week) + total views (SUM(impressions) over rows dated in the week).\nOutput (exactly 13 items per array): {"C3":[0],"C4":[{"videos":0,"views":0}]}`
  },
  15: {
    label: 'Pulling 13-week outreach trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Weekly outreach by creator level (L1–L7, same thresholds as A3) for all 13 Sun–Sat weeks in ${w.weeksRange} (America/Los_Angeles): msgs = INITIAL outreach messages ONLY per the canonical MESSAGES rule (EXCLUDE follow-up messages, dedup by message id); samples = sample requests shipped, bucketed by the request's CREATED date.\nOutput (exactly 13 items per array): {"C5":{"l1":[{"msgs":0,"samples":0}],"l2":[{"msgs":0,"samples":0}],"l3":[{"msgs":0,"samples":0}],"l4":[{"msgs":0,"samples":0}],"l5":[{"msgs":0,"samples":0}],"l6":[{"msgs":0,"samples":0}],"l7":[{"msgs":0,"samples":0}]}}`
  },
  16: {
    label: 'Pulling 6-month GMV trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nFor each of the 6 months query two metrics. Month date ranges: ${w.months.map((m: any) => `${m.key}: ${format(m.start,'yyyy-MM-dd')}–${format(m.end,'yyyy-MM-dd')}`).join(', ')}. IMPORTANT: for the current partial month (${w.months[5].key}) use the full range ${w.currentMonthStart}–${w.currentMonthEnd} — do NOT cap at ${w.d30.end}.\n1) affiliate GMV (gmv) + views from creator_store_performance for each month's exact date range.\n2) For each month call get_dashboard_performance_overview. Map totalShopGMV → shopGmv (total/account GMV including product cards). GUARDRAIL: set shopGmv to 0 for any month where shopGmvError is non-null or gmvFiltered/filteredGmvUnavailable is true.\nReturn 6 rows chronological.\nOutput (exactly 6 items): {"D1":[{"gmv":0,"shopGmv":0,"views":0}]}`
  },
  17: {
    label: 'Pulling 6-month creator posting trends…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Monthly creators, new creators, videos posted by creator level (L1–L7, same thresholds as A3; null or unmatched handle → L1, never dropped — LEFT JOIN to the creators dimension) for months ${w.monthKeys} (America/Los_Angeles publish dates). Count only creators who POSTED in each month, deduped by handle before joining levels. Each month's L1+…+L7 creators/new creators/videos must equal that month's posted totals INCLUDING unmatched-handle creators — verify against a totals row and re-run if off. Return 6 rows per level.\nOutput (exactly 6 items per array): {"D2P":{"l1":[{"creators":0,"newCreators":0,"videos":0}],"l2":[{"creators":0,"newCreators":0,"videos":0}],"l3":[{"creators":0,"newCreators":0,"videos":0}],"l4":[{"creators":0,"newCreators":0,"videos":0}],"l5":[{"creators":0,"newCreators":0,"videos":0}],"l6":[{"creators":0,"newCreators":0,"videos":0}],"l7":[{"creators":0,"newCreators":0,"videos":0}]}}`
  },
  18: {
    label: 'Pulling 6-month retention & outreach…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: For months ${w.monthKeys} (calendar months, America/Los_Angeles):\n1) Monthly retention rate — (distinct handles that posted in BOTH the prior month and that month) ÷ (distinct handles that posted in the prior month) × 100. D3 must be an array of 6 plain NUMBERS on the PERCENT scale (e.g. 30.2), NOT fractions (0.302) and NOT objects.\n2) Monthly outreach by creator level (L1–L7, same thresholds as A3): msgs = INITIAL outreach messages only per the canonical MESSAGES rule; samples = sample requests SHIPPED; approved = sample requests APPROVED (moved past "To Review" and not canceled). Both samples and approved are bucketed by the request's CREATED date (America/Los_Angeles), not ship date.\nOutput (exactly 6 items per array): {"D3":[0],"D4":{"l1":[{"msgs":0,"samples":0,"approved":0}],"l2":[{"msgs":0,"samples":0,"approved":0}],"l3":[{"msgs":0,"samples":0,"approved":0}],"l4":[{"msgs":0,"samples":0,"approved":0}],"l5":[{"msgs":0,"samples":0,"approved":0}],"l6":[{"msgs":0,"samples":0,"approved":0}],"l7":[{"msgs":0,"samples":0,"approved":0}]}}`
  },
  19: {
    label: 'Writing analysis…',
    mcp: false,
    prompt: (w, pd) => {
      const a1=pd.A1||{}, a2=pd.A2||{}
      const gmvChg = a2.gmv ? Math.round(((a1.gmv-a2.gmv)/a2.gmv)*100) : 0
      const goals = pd._goals || null
      const goalsBlock = goals ? `\nGOALS: ${JSON.stringify(goals).slice(0, 1200)}` : ''
      // "This week" figures come from the LAST element of the already-pulled
      // 13-week series — injected explicitly so the analysis can never pass a
      // trailing-30-day total off as a weekly number (that exact mistake
      // shipped in the 2026-08-24 report)
      const c1: any[] = Array.isArray(pd.C1) ? pd.C1 : []
      const wk = c1.length ? c1[c1.length - 1] : null
      const weekLine = wk
        ? `THIS WEEK — the most recent complete Sun–Sat week (${w.last7.start} to ${w.last7.end}): GMV $${wk.gmv||0}, Orders ${wk.orders||0}. These are the ONLY numbers that may be called "this week"; they equal the LAST element of the 13-week series.`
        : `THIS WEEK — the most recent complete Sun–Sat week (${w.last7.start} to ${w.last7.end}): weekly totals are the LAST element of the 13-week series in FULL DATA (key C1).`
      return `Senior analyst writing the weekly TikTok Shop affiliate report for the Ruff Liners CEO. Be direct, specific, use real numbers from the data.

DATA WINDOWS — every figure below belongs to exactly one window; always say which:
TRAILING 30 DAYS (${w.d30.start} to ${w.d30.end}): Affiliate GMV $${a1.gmv||0} (${gmvChg>0?'+':''}${gmvChg}% vs the prior 30 days), Shop GMV $${a1.shopGmv||0}, Orders ${a1.orders||0}, Videos ${a1.videos||0}, Creators ${a1.creators||0}, New ${a1.newCreators||0}, Retention ${a1.retention||0}%
${weekLine}
GMV Max (trailing 30 days): Spend $${pd.A6?.spend||0}, Revenue $${pd.A6?.revenue||0}, ROI ${pd.A6?.roi||0}x${goalsBlock}
FULL DATA: ${JSON.stringify(pd).slice(0,7000)}

FACT GUARDRAILS — these exact mistakes have shipped before; never repeat them:
- NEVER present a trailing-30-day figure as "this week", "the week of ...", or any single-week superlative ("highest single-week GMV"). The d30/A1 numbers cover ${w.d30.start}–${w.d30.end} (30 days); the week of ${w.last7.start}–${w.last7.end} is ONLY the last element of the weekly series. When you cite any dollar or count figure, state the window it came from ("30-day GMV of $X", "this week's GMV of $Y").
- NEVER conflate a % CHANGE with a % SHARE. Affiliate share of total shop GMV = affiliateGmv ÷ shopGmv × 100 (here ≈ ${a1.shopGmv ? Math.round((a1.gmv/a1.shopGmv)*1000)/10 : '?'}%). Growth-rate fields like affiliateGmvPct/shopGmvPct are changes vs the prior window — they are NOT shares, never present one as the other.
- RETENTION (retention / ret series) = % of the PRIOR period's POSTING CREATORS who posted again in the current period. It says NOTHING about buyers, returning customers, repeat purchases, or customer LTV — never describe it in those terms.

SELF-CHECK before answering: re-read your four sections and verify every dollar/count figure you quoted exists in the data above under the window your prose claims. Any figure described as weekly must match the last element of the corresponding weekly series (±rounding); any figure described as 30-day must match the d30/A1 totals. Fix mismatches before responding.

Write 4 sections:
1. "performance" (3-4 paragraphs): the most recent complete Sun–Sat week's headline numbers; month-to-date pacing vs the monthly GMV goal — state explicitly whether on or off track and by how much; quarter-to-date progress; name the creators/tiers/products driving results.
2. "creators" (2-3 paragraphs): new-creator breakouts by handle with their numbers; the top video this week (creator + GMV); which tier is most active and most productive per creator; L6/L7 activation pace.
3. "recruiting" (2-3 paragraphs): named reactivation targets with their global GMV; the current outreach mix vs where GMV actually comes from; sample allocation recommendations; concrete next-week recruiting actions.
4. "growth" (2-3 paragraphs): 13-week trend direction and momentum; the current growth engine; 2-3 specific opportunities and 1-2 risks; a 4-week forward outlook with upside and downside scenarios.

Output ONLY: {"performance":"para1\\n\\npara2","creators":"para1\\n\\npara2","recruiting":"para1\\n\\npara2","growth":"para1\\n\\npara2"}`
    }
  },
  20: {
    label: 'Saving report…',
    mcp: false,
    prompt: () => '' // handled in code, not via claude
  },
  // 21/22 pair with 13/17 — the GMV+views half of the by-tier pulls
  // (numbered after the analysis/save phases, which stay 19/20)
  21: {
    label: 'Pulling 13-week tier GMV & views…',
    mcp: true,
    // The already-pulled weekly totals (C1/C4) are pinned into the prompt as
    // hard targets — two independent runs never agree by chance on the newest
    // weeks, so the split must reconcile against the totals, not re-derive them
    prompt: (w, pd) => {
      const c1: any[] = Array.isArray(pd?.C1) ? pd.C1 : []
      const c4: any[] = Array.isArray(pd?.C4) ? pd.C4 : []
      const pins = c1.length && c4.length && c1.length === c4.length
        ? `\nAUTHORITATIVE WEEKLY TOTALS — already pulled from the same canonical definitions. Your L1+…+L7 values MUST sum to these per week within 1%; keep refining the query until every week reconciles:\nTotal GMV per week: ${JSON.stringify(c1.map((r: any) => Math.round(Number(r?.gmv) || 0)))}\nTotal views (impressions) per week: ${JSON.stringify(c4.map((r: any) => Math.round(Number(r?.views) || 0)))}`
        : `\nAlso pull each week's total GMV and total impressions and verify your L1+…+L7 sums match them within 1% before answering; re-run if off.`
      return BASE(w) + `\n\nQuery: Weekly store GMV and views by creator level (L1–L7, same thresholds as A3) for all 13 weeks in ${w.weeksRange}. Apply the canonical TIER GMV rule per week: GMV and views cover ALL creator_store_performance rows dated in the week — including GMV/impressions from evergreen videos posted before the week and from creators who did not post in it. Dedup creators by handle before joining levels. Split the range in half if the query is slow. Return 13 rows per level.${pins}\nOutput (exactly 13 items per array): {"C2V":{"l1":[{"views":0,"gmv":0}],"l2":[{"views":0,"gmv":0}],"l3":[{"views":0,"gmv":0}],"l4":[{"views":0,"gmv":0}],"l5":[{"views":0,"gmv":0}],"l6":[{"views":0,"gmv":0}],"l7":[{"views":0,"gmv":0}]}}`
    }
  },
  22: {
    label: 'Pulling 6-month tier GMV & views…',
    mcp: true,
    prompt: (w, pd) => {
      const d1: any[] = Array.isArray(pd?.D1) ? pd.D1 : []
      const pins = d1.length
        ? `\nAUTHORITATIVE MONTHLY TOTALS — already pulled from the same canonical definitions. Your L1+…+L7 values MUST sum to these per month within 1%; keep refining the query until every month reconciles:\nAffiliate GMV per month: ${JSON.stringify(d1.map((r: any) => Math.round(Number(r?.gmv) || 0)))}\nTotal views (impressions) per month: ${JSON.stringify(d1.map((r: any) => Math.round(Number(r?.views) || 0)))}`
        : `\nAlso pull each month's total GMV and total impressions and verify your L1+…+L7 sums match them within 1% before answering; re-run if off.`
      return BASE(w) + `\n\nQuery: Monthly store GMV and views by creator level (L1–L7, same thresholds as A3) for months ${w.monthKeys}. Apply the canonical TIER GMV rule per month: GMV and views cover ALL creator_store_performance rows dated in the month — including GMV/impressions from evergreen videos posted before the month and from creators who did not post in it. Dedup creators by handle before joining levels. Split by month if the query is slow. Return 6 rows per level.${pins}\nOutput (exactly 6 items per array): {"D2V":{"l1":[{"views":0,"gmv":0}],"l2":[{"views":0,"gmv":0}],"l3":[{"views":0,"gmv":0}],"l4":[{"views":0,"gmv":0}],"l5":[{"views":0,"gmv":0}],"l6":[{"views":0,"gmv":0}],"l7":[{"views":0,"gmv":0}]}}`
    }
  },
  // 23-25: the three weekly tables, scoped to the most recent complete
  // Sun–Sat week (w.last7)
  23: {
    label: 'Pulling this week\'s top creators…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: This week's top 10 creators by store GMV for the most recent complete Sun–Sat week ${w.last7.start} to ${w.last7.end}: handle, ggmv = the creator's GLOBAL gmv_30d_num from the creators dimension (their overall TikTok GMV, NOT their GMV for this store), store GMV this week (all rows dated in the week, evergreen included), views this week, videos POSTED this week (publish date in the week, America/Los_Angeles), orders, AOV. Sort by weekly store GMV descending.\nOutput: {"weeklyTopCreators":[{"h":"","ggmv":0,"gmv":0,"views":0,"vid":0,"ord":0,"aov":0}]}`
  },
  24: {
    label: 'Pulling this week\'s top videos…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: Top 10 videos by GMV among videos PUBLISHED inside the most recent complete Sun–Sat week ${w.last7.start} to ${w.last7.end} (publish date in the week, America/Los_Angeles): creator handle, ggmv = the CREATOR's global gmv_30d_num from the creators dimension (NOT this video's gmv — the two must be different numbers), product name (shorten: "Hard Bottom Backseat Extenders for Dogs with Door Protection"→"Back Seat Ext.", "XL Floor Cover for Full-Size Crew Cab Trucks with Fold Up Seats"→"XL Floor Cover", "Travel Dog Bed for Car"→"Travel Dog Bed"), GMV, views, orders, AOV, likes, comments, product clicks (null if unavailable), publish date. Sort by GMV descending.\nOutput: {"weeklyTopVideos":[{"h":"","ggmv":0,"prod":"","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":""}]}`
  },
  25: {
    label: 'Pulling this week\'s most active creators…',
    mcp: true,
    prompt: w => BASE(w) + `\n\nQuery: This week's top 10 most active creators by videos POSTED in the most recent complete Sun–Sat week ${w.last7.start} to ${w.last7.end} (publish date in the week, America/Los_Angeles): handle, ggmv = the creator's GLOBAL gmv_30d_num from the creators dimension, store GMV this week, views this week, videos posted this week, orders, AOV. Sort by videos posted descending.\nOutput: {"weeklyActiveCreators":[{"h":"","ggmv":0,"gmv":0,"views":0,"vid":0,"ord":0,"aov":0}]}`
  }
}


function assemble(w: ReturnType<typeof buildWindows>, pd: any, analysis: any) {
  const a1=pd.A1||{}, a2=pd.A2||{}, a3=pd.A3||{}, a4=pd.A4||{total:{}}, a5=pd.A5||{total:{}}, a6=pd.A6||{}
  // % change vs prior — 1 decimal everywhere, and null (not 0) when the prior
  // value is 0: the UI renders null as no-change instead of a fake 0%
  const pct=(c:number,p:number)=>p?Math.round(((c-p)/p)*1000)/10:null
  const round1=(v:any)=>{const n=Number(v);return Number.isFinite(n)?Math.round(n*10)/10:undefined}
  const delta=(c:number,p:number)=>Math.round((c-p)*10)/10
  // retention must be a percent (28.0); a model that answers with a
  // fraction (0.28) gets normalized rather than displayed as 0.28%
  const asPct=(v:any)=>{const n=Number(v)||0;return n>0&&n<=1?Math.round(n*1000)/10:n}
  // Retention SERIES arrive in whatever shape the extraction model picked —
  // plain numbers or {retention: x} objects — and sometimes on the fraction
  // scale (0.38 instead of 38). Normalize at the payload boundary: unwrap
  // objects, and if every nonzero value is < 1 the whole array is fractions,
  // so multiply by 100 once. This is what kept weekly ret at all-zeros and
  // the monthly retention chart empty against a 0-4% axis.
  const retVal=(r:any)=>{if(r&&typeof r==='object'){const v=Number(r.retention??r.ret??r.rate??r.value);return Number.isFinite(v)?v:0}const v=Number(r);return Number.isFinite(v)?v:0}
  const normRet=(rows:any[])=>{const vals=(rows||[]).map(retVal);const nz=vals.filter(v=>v>0);const frac=nz.length>0&&nz.every(v=>v<1);return vals.map(v=>Math.round((frac?v*100:v)*10)/10)}
  const LVLS=['l1','l2','l3','l4','l5','l6','l7'] as const
  const c1=pd.C1||[], c3=pd.C3||[], c4=pd.C4||[], c5=pd.C5||{}
  const d1=pd.D1||[], d3=pd.D3||[], d4=pd.D4||{}
  // by-tier series arrive as two halves (posting counts / GMV+views);
  // legacy single-phase C2/D2 payloads still resolve
  const c2p=pd.C2P||pd.C2||{}, c2v=pd.C2V||pd.C2||{}
  const d2p=pd.D2P||pd.D2||{}, d2v=pd.D2V||pd.D2||{}
  const mkTier=(lk:string)=>({
    creators:a3[lk]?.creators||0,newCreators:a3[lk]?.newCreators||0,videos:a3[lk]?.videos||0,views:a3[lk]?.views||0,gmv:a3[lk]?.gmv||0,
    gmvMaxSpend:a6[lk]?.spend||undefined,gmvMaxRoi:a6[lk]?.roi||undefined,
    msgs:a4[lk]?.msgs||0,msgsPct:pct(a4[lk]?.msgs||0,a5[lk]?.msgs||0),
    samples:a4[lk]?.samples||0,samplesPct:pct(a4[lk]?.samples||0,a5[lk]?.samples||0)
  })
  return {
    report_date:w.reportDate, label:w.label, data_window:w.dataWindow,
    d30:{
      // Provenance stamp: which spec produced this report and the exact
      // windows the server injected, echoed back so drift between the master
      // prompt, the skills, and this pipeline is verifiable from the output
      meta:{
        promptVersion:PROMPT_VERSION,
        weekWindow:{start:w.last7.start,end:w.last7.end},
        d30Window:{start:w.d30.start,end:w.d30.end},
        priorWindow:{start:w.prior.start,end:w.prior.end},
        timezone:REPORT_TZ,
        generatedAt:new Date().toISOString()
      },
      gmv:a1.gmv||0, gmvPct:pct(a1.gmv||0,a2.gmv||0),
      shopGmv:a1.shopGmv||undefined, shopGmvPct:a1.shopGmv?round1(a1.shopGmvPct):undefined,
      affiliateGmv:a1.affiliateGmv||undefined, affiliateGmvPct:a1.affiliateGmv?round1(a1.affiliateGmvPct):undefined,
      orders:a1.orders||0, ordersPct:pct(a1.orders||0,a2.orders||0),
      videos:a1.videos||0, videosPct:pct(a1.videos||0,a2.videos||0), views:a1.views||0, viewsPct:pct(a1.views||0,a2.views||0),
      creators:a1.creators||0, creatorsPct:pct(a1.creators||0,a2.creators||0), newCreators:a1.newCreators||0, newCreatorsPct:pct(a1.newCreators||0,a2.newCreators||0),
      retention:asPct(a1.retention), retentionDelta:delta(asPct(a1.retention),asPct(a2.retention)),
      gmvMax:{spend:a6.spend||0,revenue:a6.revenue||0,roi:a6.roi||0},
      gmvMaxByAge:(pd.A7&&pd.A7.length>0)?sanitizeRows(pd.A7):undefined,
      msgs:a4.total?.msgs||0, msgsPct:pct(a4.total?.msgs||0,a5.total?.msgs||0),
      samples:a4.total?.samples||0, samplesPct:pct(a4.total?.samples||0,a5.total?.samples||0),
      tiers:Object.fromEntries(LVLS.map(lk=>[lk,mkTier(lk)])) as any
    },
    weekly_charts:{
      labels:w.weekLabels, gmv:c1.map((r:any)=>r.gmv||0), views:c4.map((r:any)=>r.views||0),
      ...Object.fromEntries(LVLS.map(lk=>[`crl${lk[1]}`,c2p[lk]?.map((r:any)=>r.creators||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`ncl${lk[1]}`,c2p[lk]?.map((r:any)=>r.newCreators||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`vl${lk[1]}`,c2p[lk]?.map((r:any)=>r.videos||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`gl${lk[1]}`,c2v[lk]?.map((r:any)=>r.gmv||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`vwl${lk[1]}`,c2v[lk]?.map((r:any)=>r.views||0)||[]])),
      ret:normRet(c3), vid:c4.map((r:any)=>r.videos||0),
      ...Object.fromEntries(LVLS.map(lk=>[`ml${lk[1]}`,c5[lk]?.map((r:any)=>r.msgs||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`sl${lk[1]}`,c5[lk]?.map((r:any)=>r.samples||0)||[]]))
    },
    monthly_charts:{
      labels:w.monthLabels, gmv:d1.map((r:any)=>r.gmv||0),
      // contract keys: shopGmv (total account GMV) + affiliateGmv, always
      // present; totalGmv kept as a legacy alias until old reports are gone
      shopGmv:d1.map((r:any)=>r.shopGmv||0),
      totalGmv:d1.every((r:any)=>!r.shopGmv)?undefined:d1.map((r:any)=>r.shopGmv||0),
      affiliateGmv:d1.map((r:any)=>r.gmv||0),
      views:d1.map((r:any)=>r.views||0),
      ...Object.fromEntries(LVLS.map(lk=>[`crl${lk[1]}`,d2p[lk]?.map((r:any)=>r.creators||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`ncl${lk[1]}`,d2p[lk]?.map((r:any)=>r.newCreators||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`vl${lk[1]}`,d2p[lk]?.map((r:any)=>r.videos||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`gl${lk[1]}`,d2v[lk]?.map((r:any)=>r.gmv||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`vwl${lk[1]}`,d2v[lk]?.map((r:any)=>r.views||0)||[]])),
      ret:normRet(d3),
      ...Object.fromEntries(LVLS.map(lk=>[`ml${lk[1]}`,d4[lk]?.map((r:any)=>r.msgs||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`sl${lk[1]}`,d4[lk]?.map((r:any)=>r.samples||0)||[]])),
      // samples APPROVED by level per month (request-created date basis);
      // contract requires the keys even when every value is 0
      ...Object.fromEntries(LVLS.map(lk=>[`sal${lk[1]}`,d4[lk]?.map((r:any)=>r.approved||0)||Array(w.monthLabels.length).fill(0)]))
    },
    tables:sanitizeTables({
      topCreators:pd.topCreators||[], topVideos:pd.topVideos||[], activeCreators:pd.activeCreators||[],
      weeklyTopCreators:pd.weeklyTopCreators||[], weeklyTopVideos:pd.weeklyTopVideos||[], weeklyActiveCreators:pd.weeklyActiveCreators||[]
    }),
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
        { role: 'user', content: 'Now output ONLY the JSON object with the exact structure I specified. Start your response with { and end with }. Nothing else. Use ONLY the data you already pulled. For a scalar metric you could not retrieve, use 0. For a table/array you could not retrieve, output an EMPTY array [] — NEVER emit placeholder rows with empty handles or all-zero fields, and NEVER estimate or invent a value.' }
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
// 4 attempts: a flurry of upstream 520s/timeouts on a long phase should not
// kill a 40-minute job on its own
const MAX_PHASE_ATTEMPTS = 4
// A run-marked phase younger than this is treated as still executing; older
// means its runner died (deploy, crash, platform kill) and it may be re-claimed
const IN_FLIGHT_MS = 10 * 60 * 1000

const dataPhasesFor = (isLive: boolean) =>
  isLive
    ? Array.from({ length: 11 }, (_, i) => i + 1)
    : [...Array.from({ length: 18 }, (_, i) => i + 1), 21, 22, 23, 24, 25]

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
  const liveTierNote = tierDefinitionNote(fullReport.d30)
  if (liveTierNote) reconWarnings.push(liveTierNote)
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
  const today = todayInReportTz(params.today)
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
  const claimedRow = await casUpdate(supabase, jobId, (row: any) => {
    const curPd = row.phase_data || {}
    const curPh = curPd._ph || seedPhaseState(row)
    const now = Date.now()
    const done = (p: number) => curPh[p]?.s === 'done'
    const fresh = (p: number) => curPh[p]?.s === 'run' && now - (curPh[p]?.t || 0) < IN_FLIGHT_MS
    const ready = dataPhases.filter(p => !done(p) && !fresh(p))
      // 21/22 reconcile against totals pinned from earlier phases — hold them
      // back until those totals have landed
      .filter(p => (p !== 21 || (done(12) && done(14))) && (p !== 22 || done(16)))
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
        pd._goals = goalsSnap // weekly analysis paces MTD/QTD against the goals
        const analysisPrompt = isMonthly
          ? monthlyAnalysisPrompt(w, pd, goalsSnap)
          : phaseConfig.prompt(w, pd)
        const text = await callClaude(analysisPrompt, apiKey, false, 8000, ANALYSIS_MODEL)
        await finishPhase(supabase, jobId, 19, extractJson(text), isLive)
        return
      }

      // Phase 20 — assemble and save. Weekly and monthly analyses both use the
      // four contract sections; the d30/weekly/monthly branch only remains for
      // jobs already mid-flight when the analysis phase still wrote old keys.
      const analysis = (pd.performance !== undefined || pd.recruiting !== undefined || isMonthly)
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

      // Validate before saving: generated numbers must reconcile against the
      // canonical definitions. On failure, re-pull the phases the bad numbers
      // came from with the failure text appended to their prompts (max 2
      // retries); a report that still fails is rejected — the job errors out
      // and nothing is saved, instead of shipping a warning banner.
      const issues = validateGeneratedReport(report)
      if (issues.length) {
        const retried = Number(pd._validationRetries || 0)
        if (retried < 2) {
          const redo = new Set<number>()
          for (const iss of issues) for (const p of phasesForIssue(iss)) redo.add(p)
          console.warn(`Job ${jobId}: validation failed (attempt ${retried + 1}), re-pulling phases ${[...redo].join(',')}:`, issues)
          await casUpdate(supabase, jobId, (row: any) => {
            const curPd = row.phase_data || {}
            const newPh = { ...(curPd._ph || {}) }
            for (const p of redo) newPh[p] = { s: 'retry', a: 0 }
            newPh[19] = { s: 'retry', a: 0 } // analysis quotes the numbers — rewrite it
            newPh[20] = { s: 'retry', a: 0 } // this save attempt; re-claimable once data lands
            return {
              phase_data: { ...curPd, _validationRetries: retried + 1, _validationNotes: issues.join('\n'), _ph: newPh },
              phase_label: `Numbers did not reconcile — re-pulling data (retry ${retried + 1} of 2)…`
            }
          })
          return
        }
        await supabase.from('report_jobs').update({
          status: 'error',
          error: ('Report failed validation after 2 retries — nothing was saved. ' + issues.join('; ')).slice(0, 500),
          updated_at: new Date().toISOString()
        }).eq('id', jobId)
        return
      }
      // Softer reconcile warnings still banner anything the strict gate does
      // not cover (messages/samples drift)
      const reconWarnings = reconcileD30(report.d30)

      // Sanity diff vs the prior report of the same type: implausible
      // window-over-window swings, $0 GMV, all-zero series, a tier split that
      // doesn't decompose d30.gmv to the dollar, or suspiciously round
      // monetary values flag the report needsReview — it saves with a visible
      // banner but is held out of the live snapshot until a human confirms
      // the numbers against Euka
      let priorD30: any = null
      try {
        const { data: priors } = await supabase.from('weekly_reports')
          .select('report_date, d30')
          .lt('report_date', report.report_date)
          .order('report_date', { ascending: false })
          .limit(10)
        priorD30 = (priors ?? []).find(r => isMonthly === /-M$/.test(r.report_date))?.d30 ?? null
      } catch { /* first report ever — sanity diff runs without a prior */ }

      // Flags a human already marked reviewed/expected (app_config key
      // 'reviewed_flags', managed via /api/admin/review-flags) demote to
      // informational notes — a known one-time correction (e.g. a fixed data
      // source legitimately moving a metric outside the ±60% band) must not
      // re-fire needsReview on every subsequent run
      let reviewedKeys: string[] = []
      try {
        const { data: rk } = await supabase.from('app_config').select('value').eq('key', 'reviewed_flags').single()
        if (rk?.value) reviewedKeys = JSON.parse(rk.value)
      } catch { /* no reviewed flags stored yet */ }
      const allFlags = collectReviewFlags(report, priorD30)
      const { active: reviewFlags, reviewed } = splitReviewed(allFlags, reviewedKeys)
      if (reviewFlags.length) (report.d30 as any).needsReview = reviewFlags.map(f => f.text)
      if (reviewFlags.length || reviewed.length) (report.d30 as any).reviewFlagKeys = allFlags.map(f => ({ key: f.key, reviewed: reviewedKeys.includes(f.key) }))

      const tierNote = tierDefinitionNote(report.d30)
      const banner = [
        ...reviewFlags.map(f => `NEEDS REVIEW: ${f.text}`),
        ...reviewed.map(f => `Reviewed/expected: ${f.text}`),
        ...reconWarnings,
        ...(tierNote ? [tierNote] : [])
      ]
      if (banner.length) (report.d30 as any).reconciliation = banner

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
      // report's window is the calendar month, not the trailing 30 days.
      // A needs-review report never overwrites the live snapshot: the saved
      // report page shows the flags, the live page keeps the last good data.
      if (!isMonthly && !reviewFlags.length) {
        const liveData = {
          report_date: report.report_date,
          label: report.label,
          data_window: report.data_window,
          d30: report.d30,
          tables: report.tables,
          agents: report.agents,
          analysis: { d30: report.analysis?.d30 || report.analysis?.performance || '' },
        }
        await supabase.from('app_config').upsert({ key:'live_report', value: JSON.stringify(liveData) }, { onConflict:'key' })
      }
      await supabase.from('report_jobs').update({
        status:'done', phase:20,
        phase_label: reviewFlags.length ? 'Complete — needs review ⚠ (see report banner)' : 'Complete ✓',
        updated_at:new Date().toISOString()
      }).eq('id',jobId)
      return
    }

    // Data phase — an independent Euka pull. Most phases ignore prior data;
    // 21/22 read the already-pulled totals from it as reconciliation targets
    // (the claimed row is fresh — the initial `job` fetch predates the claim)
    let delta: any
    const claimedPd = claimedRow?.phase_data || job.phase_data || {}
    const basePrompt = phaseConfig.promptLive
      ? phaseConfig.promptLive(w, claimedPd)
      : phaseConfig.prompt(w, claimedPd)
    // A validation-retry round carries the failure back into the re-pulled
    // phases so the model knows exactly which interpretation to correct
    const validationNotes = claimedPd._validationNotes
    const activePrompt = validationNotes && !phaseConfig.isAgents
      ? basePrompt + `\n\nPREVIOUS ATTEMPT FAILED VALIDATION — the last run of this report produced the inconsistencies below. Follow the canonical definitions and totals-row verification so they do not recur:\n${validationNotes}`
      : basePrompt
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
    // Transient failures (slow MCP pull timing out, Anthropic overloaded, a
    // response that narrated tool work and truncated before its JSON) get the
    // phase re-run by the next kick instead of killing the job
    const transient = /timeout|unreachable|overloaded|Claude API 5\d\d|mcp_tool_result|No JSON in Claude response/i.test(msg)
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
