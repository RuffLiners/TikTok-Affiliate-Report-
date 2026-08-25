# Weekly Report Prompt

## How to use this

1. Fill in the **[BRACKETED FIELDS]** below with your specific information
2. Calculate the date windows (instructions below)
3. Paste the entire prompt into Claude Desktop (with Euka MCP connected)
4. Claude will pull all your data and output a JSON object — copy the entire thing
5. Paste the JSON into your dashboard via Manual Entry

## Calculating your date windows

Run this report on any day. Use the following logic:

- **Report date**: Today's date (YYYY-MM-DD)
- **Current 30d end**: 2 days ago (TikTok data has a ~2-day lag)
- **Current 30d start**: 30 days before the end date
- **Prior 30d**: The 30 days immediately before the current 30d window
- **Last complete week**: The most recent completed Sun–Sat week before your end date
- **13 weeks**: 13 complete Sun–Sat weeks ending on the last complete week's Saturday
- **6 months**: The 5 complete calendar months before this month + current month through your end date

**Example** (running on June 12, 2026):
- Report date: 2026-06-12
- Current 30d: 2026-05-13 to 2026-06-10
- Prior 30d: 2026-04-13 to 2026-05-12
- Last complete week: 2026-06-01 to 2026-06-07
- 13 weeks: starting from ~2026-03-08, ending 2026-06-07
- 6 months: Jan, Feb, Mar, Apr, May (complete) + Jun through 2026-06-10

---

## THE PROMPT (paste everything below into Claude Desktop)

Run the [YOUR BRAND NAME] TikTok Shop weekly report for today [REPORT DATE, e.g. June 12, 2026].

Store ID: [YOUR EUKA STORE ID]

DATE WINDOWS — use these exactly:
- Current 30d: [START DATE] to [END DATE]
- Prior 30d: [PRIOR START] to [PRIOR END]
- Last complete week (most recent Sun–Sat): [WEEK START] to [WEEK END] — use this as "this week" in analysis
- 13 complete Sun–Sat weeks ending on [WEEK END] (inclusive — the most recent complete week IS included)
- 6 months: the 5 complete calendar months before this one + current partial month through [END DATE]

TIMEZONE: ALL date bucketing — video publish dates, Sun–Sat week boundaries, month boundaries, message dates, sample request dates — uses America/Los_Angeles (TikTok Shop reporting time), never UTC.

CANONICAL METRIC DEFINITIONS — authoritative; never substitute another interpretation. query_store_data is a natural-language SQL agent that picks a different interpretation run-to-run unless each metric is pinned:
- VIEWS = SUM(impressions) from creator_store_performance rows dated in the window. NOT creator_videos view counts, NOT lifetime cumulative views.
- ORDERS = SUM(items_sold_count) from creator_store_performance in the window, ALL attribution — never scoped to videos posted in-window.
- AFFILIATE GMV (d30.gmv) = bare SUM(gmv) from creator_store_performance in the window (includes video + livestream + showcase creator GMV). The separate d30.affiliateGmv field = the dashboard overview's totalAffiliateGMV, a differently-attributed dashboard metric that runs LOWER by design — the two are different metrics and are not expected to match. Tier GMV decomposes d30.gmv, never d30.affiliateGmv.
- CREATORS = DISTINCT handles that POSTED a video in the window, deduped by handle (the creators table has duplicate-handle rows). Handles with NO match in the creators dimension STILL COUNT in every metric and bucket into L1 — LEFT JOIN, never drop them. NEW CREATORS = first-ever post for this store falls in the window.
- RETENTION = (distinct handles that posted in BOTH windows) ÷ (distinct handles that posted in the prior window), as a PERCENT 0–100 (28.0, never 0.28).
- TIER GMV/VIEWS (l1–l7) = ALL GMV/impressions earned in the period attributed to the earning creator's level — INCLUDING evergreen videos posted before the period. Dedup by handle before joining. L1+…+L7 MUST sum to the period totals — request a totals row and verify; re-run if off, never hand-patch. Same rule per week and per month for the chart series.
- GMV MAX header = the GMV Max ad tables ONLY (same source as the content-age buckets, so header spend === sum of bucket spends). NEVER get_dashboard_ads_overview totalAdSpend — it includes non-GMV-Max spend.
- MESSAGES = INITIAL outreach messages only, deduped by message id — EXCLUDE follow-ups. Applies at every grain.
- SAMPLES (shipped) and SAMPLES APPROVED = bucketed by the sample REQUEST's CREATED date — never ship date.
- NEVER estimate, interpolate, or fabricate a value. If a query fails after retries, output 0 (or []/null) and record it in validation.flags. NEVER emit placeholder table rows with empty handles or all-zero fields — every table row must name a real creator handle from an actual query result; a table you could not retrieve is [] plus a flag.

QUERIES TO RUN (read every CSV file Euka returns):
1. Current 30d totals: (a) GMV, orders, videos posted, views, creators posted, new creators (first-ever post for this store), retention rate vs prior period from creator_store_performance; (b) call get_dashboard_performance_overview for the same window and read fields named exactly "totalShopGMV" → shopGmv and "totalAffiliateGMV" → affiliateGmv. GUARDRAIL: only use totalShopGMV when gmvFiltered === false AND filteredGmvUnavailable === false AND shopGmvError === null; otherwise set shopGmv to 0
2. Prior 30d: same totals for % change calculations
3. Current 30d by creator level (L1 = global gmv_30d <$5K, L2 = $5K–$25K, L3 = $25K–$60K, L4 = $60K–$150K, L5 = $150K–$400K, L6 = $400K–$1.5M, L7 = $1.5M+): creators, new creators, videos posted, total views, store GMV — L1+…+L7 views must sum to the overall 30d total views (do not leave views as 0)
4. Current 30d outreach by level: initial messages sent (per the MESSAGES rule) + samples shipped + samples approved (request-created date), plus overall totals
5. Prior 30d outreach: totals + by level (for % change)
6. GMV Max current 30d: spend, attributed revenue, blended ROI from the GMV Max ad tables ONLY per the GMV MAX header rule (use 0 if data unavailable)
7. Top 15 creators by store GMV — handle, followers, store GMV, global gmv_30d, views, videos L30d, videos w/GMV L30d, lifetime videos, videos L7d, orders, AOV, engagement rate
8. For the top 15 handles from #7: count of videos that generated any GMV this period, and lifetime total videos for this store
9. Top 15 videos by store GMV — creator handle, product name, GMV, views, orders, AOV, publish date, likes, comments, product clicks
10. Top 15 creators by videos posted — handle, followers, GMV from new-period videos only, total store GMV, views, avg views/video, orders
11. 13 weekly totals: GMV, orders, views, videos (13 rows, one per Sun–Sat week)
12. 13 weeks by level (L1–L7): creators posted, new creators, videos, views, store GMV per week per level (91 rows) — include views per level per week
13. 13 weeks: retention rate per week (13 rows)
14. 13 weeks: messages sent + samples shipped by level per week (91 rows)
15. 6 months: for each month query its exact date range (current partial month goes through today — do NOT cap at the 30d end date). For each month: (a) affiliate GMV (gmv) + views from creator_store_performance, (b) call get_dashboard_performance_overview and read the field named exactly "totalShopGMV" → output as shopGmv; also read "totalAffiliateGMV" → output as affiliateGmv. GUARDRAIL: only use totalShopGMV when gmvFiltered === false AND filteredGmvUnavailable === false AND shopGmvError === null; otherwise set shopGmv to 0. Set shopGmv/affiliateGmv to 0 if unavailable. (6 rows)
16. 6 months by level (L1–L7): creators, new creators, videos, views, GMV (42 rows) — include views per level per month
17. 6 months: retention rate per month (6 rows)
18. 6 months: messages sent + samples shipped + samples approved by level per month (42 rows; samples approved maps to sal1–sal7)
19. This week's top 10 creators by store GMV ([WEEK START]–[WEEK END]): handle, global gmv_30d, store GMV this week, views this week, videos posted this week, orders, AOV
20. Top 10 videos by GMV posted this week ([WEEK START]–[WEEK END]): creator handle, global gmv_30d, product name, GMV, views, orders, AOV, likes, comments, product clicks, publish date
21. This week's top 10 most active creators by videos posted ([WEEK START]–[WEEK END]): handle, global gmv_30d, store GMV this week, views this week, videos posted, orders, AOV
22. GMV Max spend current 30d ([START DATE]–[END DATE]) broken down by content age. Buckets by video publish date vs [END DATE]: "< 30 days" (posted in last 30 days), "1–2 months" (31–60 days old), "2–3 months" (61–90 days), "3–5 months" (91–150 days), "5+ months" (151+ days), "Unknown post date" (publish date missing). For each non-empty bucket: label, videos (count), spend, revenue, roi (revenue/spend, 0 if no spend), pct (spend % of total). Omit empty buckets. Output [] if GMV Max data unavailable.
23. Outreach & CRM agents created in the last 30 days ([START DATE]–[END DATE]): call list_outreach_agents with agentType="outreach" and agentType="crm", multiple searchQuery values ("", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "Video Volume", "GMV Contest", "New Agent"), limit=25, archived=false. Merge and deduplicate by id, keep only agents with created_time >= [START DATE]. Call get_outreach_agent for each to enrich. Map to: id, name, agent_type ("outreach"/"crm"), campaign_type, status (bot_status), date_posted (YYYY-MM-DD from created_time), gmv_filter (target_gmvs joined ", "; "none" if empty), kw_filter (target_categories joined ", "; "none" if empty), other_filters (summary of other non-empty target_* fields; "none" if all empty), list_segment (lists/segments names; "none" if absent), commission_display (unique commission rate; "none" if absent), creators_reached (total_conversations), remaining (remaining_creators), total_invites, accepted_invites, total_replies, samples_requested (total_sample_request), samples_shipped, total_videos, total_revenue, product_count (length of products array), has_followups.

ANALYSIS — write 4 focused sections after pulling all data.
WINDOW LABELING (mistakes here have shipped before): d30 fields cover the trailing 30 days — NEVER present one as "this week", "the week of …", or any single-week superlative. "This week" = the most recent complete Sun–Sat week = the LAST element of each weeklyCharts series. Every dollar or count figure the prose cites MUST state the window it came from ("30-day GMV of $X", "this week's GMV of $Y"). Never conflate a % CHANGE with a % SHARE, and retention is posting-creator retention (says nothing about buyers or repeat purchases).
- "performance": 3–4 paragraphs — This week's headline numbers (last complete Sun–Sat week), MTD progress vs monthly goal (state if on/off track and by how much), QTD progress vs quarterly goal, what's driving results. Be specific: name the creators/products/tiers moving the numbers.
- "creators": 2–3 paragraphs — New creator breakouts: any creator in their first 1–3 weeks already generating meaningful GMV (name them, their numbers, why they're exciting). Top performing content this week (specific video + creator + GMV). Which level is most active and most productive per creator. L6/L7 activation pace vs target.
- "recruiting": 2–3 paragraphs — Top reactivation targets: inactive creators with high global GMV who haven't posted recently (name them, their global GMV, last post timing). Current outreach mix analysis (L3/L4 vs L5+ balance, is it aligned with where GMV comes from?). Sample allocation recommendations. Concrete next-week recruiting actions.
- "growth": 2–3 paragraphs — 13-week GMV trend direction and momentum. Which tier/product/content format is the primary growth engine right now. 2–3 specific opportunities to pursue this week. 1–2 risks to monitor. 4-week forward outlook with upside and downside scenarios.

SELF-VALIDATE before output (fix by re-querying, never by editing numbers):
V1/V2 tier gmv and views sum to the 30d totals (±1%) · V3 tier creators/newCreators/videos sum exactly · V4 gmvMax.spend = Σ gmvMaxByAge spend (±1%) · V5/V6 weekly gl*/vwl* sum to each week's gmv/views (±1%) · V7 every weekly series has exactly 13 items, every monthly series 6 · V8 no negatives · V9 retention on the percent scale · V10 gmv > 0 · V11 no 30d metric moved more than ±60% vs prior without a known cause · V12 weekly gmv not all zeros · V13 every required table (topCreators, topVideos, activeCreators, weeklyTopCreators, weeklyTopVideos, weeklyActiveCreators) is non-empty AND every row has a non-empty handle h — the dashboard hard-rejects a report failing this · V14 Σ tier gmv = d30.gmv within $1 (tier GMV decomposes d30.gmv, never d30.affiliateGmv) · V15 flag any monetary value that is an exact round multiple of $10,000 for a manual spot-check.
Set validation.passed = true only if all checks hold; otherwise list each failure in validation.flags and still output the report.
POST-GENERATION SELF-CHECK: before finalizing, re-read the analysis sections and verify every dollar/count figure quoted appears in the JSON under the window the prose claims; a figure described as weekly must match the last element of the corresponding weeklyCharts array (±rounding).

OUTPUT — respond with ONLY this JSON object, nothing before or after it. CRITICAL: include EVERY field shown below — never omit a field even if its query returned no data (use empty arrays [] or 0 as defaults). The fields gmvMaxByAge, agents, vwl1–vwl7, sal1–sal7, and level views are required even if empty:

{
  "meta": {
    "reportDate": "YYYY-MM-DD",
    "label": "Month D, YYYY",
    "dataWindow": "Mon D – Mon D, YYYY",
    "promptVersion": "3.1",
    "weekWindow": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "d30Window": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "priorWindow": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "timezone": "America/Los_Angeles",
    "generatedAt": "ISO-8601 timestamp"
  },
  "d30": {
    "gmv": 0, "gmvPct": 0, "shopGmv": 0, "shopGmvPct": 0, "affiliateGmv": 0, "affiliateGmvPct": 0,
    "orders": 0, "ordersPct": 0,
    "videos": 0, "videosPct": 0, "views": 0, "viewsPct": 0,
    "creators": 0, "creatorsPct": 0, "newCreators": 0, "newCreatorsPct": 0,
    "retention": 0, "retentionDelta": 0,
    "gmvMax": { "spend": 0, "revenue": 0, "roi": 0 },
    "gmvMaxByAge": [],
    "msgs": 0, "msgsPct": 0, "samples": 0, "samplesPct": 0,
    "tiers": {
      "l1": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "l2": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "l3": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "l4": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "l5": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "l6": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "l7": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 }
    }
  },
  "weeklyCharts": {
    "labels": [],
    "gmv":[],"views":[],
    "crl1":[],"crl2":[],"crl3":[],"crl4":[],"crl5":[],"crl6":[],"crl7":[],
    "ncl1":[],"ncl2":[],"ncl3":[],"ncl4":[],"ncl5":[],"ncl6":[],"ncl7":[],
    "vl1":[],"vl2":[],"vl3":[],"vl4":[],"vl5":[],"vl6":[],"vl7":[],
    "gl1":[],"gl2":[],"gl3":[],"gl4":[],"gl5":[],"gl6":[],"gl7":[],
    "vwl1":[],"vwl2":[],"vwl3":[],"vwl4":[],"vwl5":[],"vwl6":[],"vwl7":[],
    "ret":[],"vid":[],
    "ml1":[],"ml2":[],"ml3":[],"ml4":[],"ml5":[],"ml6":[],"ml7":[],
    "sl1":[],"sl2":[],"sl3":[],"sl4":[],"sl5":[],"sl6":[],"sl7":[]
  },
  "monthlyCharts": {
    "labels": [],
    "gmv":[],"shopGmv":[],"affiliateGmv":[],"views":[],
    "crl1":[],"crl2":[],"crl3":[],"crl4":[],"crl5":[],"crl6":[],"crl7":[],
    "ncl1":[],"ncl2":[],"ncl3":[],"ncl4":[],"ncl5":[],"ncl6":[],"ncl7":[],
    "vl1":[],"vl2":[],"vl3":[],"vl4":[],"vl5":[],"vl6":[],"vl7":[],
    "gl1":[],"gl2":[],"gl3":[],"gl4":[],"gl5":[],"gl6":[],"gl7":[],
    "vwl1":[],"vwl2":[],"vwl3":[],"vwl4":[],"vwl5":[],"vwl6":[],"vwl7":[],
    "ret":[],
    "ml1":[],"ml2":[],"ml3":[],"ml4":[],"ml5":[],"ml6":[],"ml7":[],
    "sl1":[],"sl2":[],"sl3":[],"sl4":[],"sl5":[],"sl6":[],"sl7":[],
    "sal1":[],"sal2":[],"sal3":[],"sal4":[],"sal5":[],"sal6":[],"sal7":[]
  },
  "tables": {
    "topCreators": [],
    "topVideos": [],
    "activeCreators": [],
    "weeklyTopCreators": [],
    "weeklyTopVideos": [],
    "weeklyActiveCreators": []
  },
  "agents": [],
  "analysis": {
    "performance": "",
    "creators": "",
    "recruiting": "",
    "growth": ""
  },
  "validation": { "passed": true, "flags": [] }
}

Table row formats:
- topCreators: { "h":"handle","flw":0,"sgmv":0,"ggmv":0,"views":0,"v30":0,"vmgmv":0,"vlife":0,"v7":0,"ord":0,"aov":0,"eng":null }
- topVideos: { "h":"handle","ggmv":0,"prod":"product name","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":"Mon D" }
- activeCreators: { "h":"handle","ggmv":0,"flw":0,"v30":0,"gmvN":0,"gmvT":0,"views":0,"avgv":0,"ord":0 }
- weeklyTopCreators: { "h":"handle","ggmv":0,"gmv":0,"views":0,"vid":0,"ord":0,"aov":0 }
- weeklyTopVideos: { "h":"handle","ggmv":0,"prod":"product name","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":"Mon D" }
- weeklyActiveCreators: { "h":"handle","ggmv":0,"gmv":0,"views":0,"vid":0,"ord":0,"aov":0 }
