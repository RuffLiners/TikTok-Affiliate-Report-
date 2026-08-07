---
name: tiktok-weekly-report
description: Pull all TikTok Shop KPI data for a brand from Euka, write four focused analysis sections, and output one complete JSON object for the TikTok Affiliate Report dashboard. Use whenever the user says "run the weekly report", "generate the weekly report", "pull this week's data", "run the Monday report", or any variation. Requires the Euka MCP connector. Outputs one JSON block — nothing else. For ad-hoc exploration and in-Claude visualization use tiktok-dashboard-analysis instead.
---

# TikTok Shop Weekly Report (Euka → dashboard JSON)

You are generating the weekly TikTok Shop affiliate report. The output of this skill is **one JSON object and nothing else** — the user pastes it into their dashboard's Manual Entry panel (or `scripts/insert-report.ts`).

## Prerequisites

- The **Euka MCP connector** must be available (tools like `query_store_data`, `get_dashboard_performance_overview`, `list_outreach_agents`). If the tools are missing, stop and tell the user to connect Euka first.
- You need the user's **brand name** and **Euka Store ID**. If they weren't provided in this conversation or a project/profile note, ask for them before starting.

## Date windows

Compute from today's date (all dates in **America/Los_Angeles**):

- **Report date**: today (YYYY-MM-DD)
- **Current 30d end**: 2 days ago (TikTok data lags ~2 days); **start**: 30 days before the end
- **Prior 30d**: the 30 days immediately before the current window
- **Last complete week**: the most recent completed Sun–Sat week before the end date — this is "this week" in analysis
- **13 weeks**: 13 complete Sun–Sat weeks ending on that Saturday (inclusive)
- **6 months**: the 5 complete calendar months before this one + the current month through today (do NOT cap the current month at the 30d end date)

State the computed windows before pulling data, and use them exactly.

## CRITICAL — determinism (canonical metric definitions)

`query_store_data` is a natural-language SQL agent that picks a different interpretation run-to-run unless each metric is pinned. These definitions are authoritative — never substitute another interpretation. (They must stay in sync with `dashboard/src/lib/canonicalDefs.ts` in the kit.)

- **VIEWS** = SUM(impressions) from creator_store_performance rows dated in the window. NOT creator_videos view counts, NOT lifetime cumulative views.
- **ORDERS** = SUM(items_sold_count) from creator_store_performance in the window, ALL attribution. Do NOT scope to videos posted in-window.
- **AFFILIATE GMV** = bare SUM(gmv) from creator_store_performance in the window. This is authoritative.
- **SHOP GMV** = get_dashboard_performance_overview field "totalShopGMV", only when gmvFiltered === false AND filteredGmvUnavailable === false AND shopGmvError === null; else 0.
- **CREATORS** = DISTINCT handles that POSTED a video in the window, deduped by handle (creators table has duplicate-handle rows). NEW CREATORS = first-ever post for this store falls in the window. NOT any-activity handles. Handles with NO match in the creators dimension (no gmv_30d) STILL COUNT in every metric — creators, new creators, videos, views, GMV — and bucket into L1; never drop them (LEFT JOIN, not inner join).
- **RETENTION** = (distinct handles that posted in BOTH the prior 30d window and the current window) / (distinct handles that posted in the prior window). Delta is current minus prior retention, in points.
- **TIER GMV (l1–l7)** = ALL GMV earned during the period from creator_store_performance, attributed to the earning creator's level — INCLUDING GMV from evergreen videos posted before the period. It is NOT limited to videos posted in-period. Levels from gmv_30d_num: L1 <5K, L2 5–25K, L3 25–60K, L4 60–150K, L5 150–400K, L6 400K–1.5M, L7 1.5M+; null or unmatched handle → L1. Dedup creators by handle BEFORE joining to prevent fan-out. The 7 levels MUST sum to the period's total affiliate GMV — request a totals row and verify before accepting. Same rule applies to tier views (sum to total impressions) and to the weekly/monthly per-tier series (sum to each week's/month's total). If it doesn't reconcile, re-run the query; never hand-patch.
- **GMV MAX header (spend/revenue/roi)** = GMV Max ad tables ONLY, same source as the content-age buckets, so header spend === sum of bucket spend. Do NOT use the dashboard's totalAdSpend for the header.
- **MESSAGES** = INITIAL outreach messages ONLY, deduped by message id — EXCLUDE follow-up messages. NOT total message events, NOT distinct creators messaged. Applies to every grain: 30d totals, per-tier msgs, weekly ml1–ml7, monthly ml1–ml7.
- **SAMPLES (shipped) and SAMPLES APPROVED** are both bucketed by the sample REQUEST's CREATED date in America/Los_Angeles — never ship date, never UTC — at every grain (30d, weekly sl*, monthly sl*, monthly sal*). APPROVED = the request moved past "To Review" and was not canceled.
- **TIMEZONE** = ALL date bucketing (video publish dates, Sun–Sat week boundaries, month boundaries, message dates, sample request dates) uses America/Los_Angeles, never UTC.
- **HEAVY TIER QUERIES TIME OUT**: run weekly-by-tier and monthly-by-tier as separate calls (posting columns, then views, then GMV; split GMV by month/half-range if needed).
- If a query returns 0 rows or claims the current year is "in the future," retry stating the year explicitly — the data exists.

## Queries to run (read every CSV file Euka returns)

1. **Current 30d totals**: (a) GMV, orders, videos posted, views, creators posted, new creators (first-ever post for this store), retention rate vs prior period from creator_store_performance; (b) call get_dashboard_performance_overview for the same window and read fields named exactly "totalShopGMV" → shopGmv and "totalAffiliateGMV" → affiliateGmv, applying the SHOP GMV guardrail above.
2. **Prior 30d**: same totals for % change calculations.
3. **Current 30d by creator level** (L1–L7 per the tier definition): creators, new creators, videos posted, total views, store GMV — L1+…+L7 views must sum to the overall 30d total views (do not leave views as 0).
4. **Current 30d outreach by level**: messages sent + samples shipped + samples approved, plus overall totals.
5. **Prior 30d outreach**: totals + by level (for % change).
6. **GMV Max current 30d**: total ad spend, attributed revenue, blended ROI (0 if unavailable).
7. **Top 15 creators by store GMV** — handle, followers, store GMV, global gmv_30d, views, videos L30d, videos w/GMV L30d, lifetime videos, videos L7d, orders, AOV, engagement rate.
8. For the top 15 handles from #7: count of videos that generated any GMV this period, and lifetime total videos for this store.
9. **Top 15 videos by store GMV** — creator handle, product name, GMV, views, orders, AOV, publish date, likes, comments, product clicks.
10. **Top 15 creators by videos posted** — handle, followers, GMV from new-period videos only, total store GMV, views, avg views/video, orders.
11. **13 weekly totals**: GMV, orders, views, videos (13 rows, one per Sun–Sat week).
12. **13 weeks by level (L1–L7)**: creators posted, new creators, videos, views, store GMV per week per level (91 rows) — include views per level per week.
13. **13 weeks**: retention rate per week (13 rows).
14. **13 weeks**: messages sent + samples shipped by level per week (91 rows).
15. **6 months**: for each month query its exact date range (current partial month goes through today). For each month: (a) affiliate GMV (gmv) + views from creator_store_performance, (b) get_dashboard_performance_overview → "totalShopGMV" → shopGmv and "totalAffiliateGMV" → affiliateGmv, with the SHOP GMV guardrail; 0 if unavailable. (6 rows)
16. **6 months by level (L1–L7)**: creators, new creators, videos, views, GMV (42 rows) — include views per level per month.
17. **6 months**: retention rate per month (6 rows).
18. **6 months**: messages sent + samples shipped + samples approved by level per month (42 rows; samples approved maps to sal1–sal7).
19. **This week's top 10 creators by store GMV** (last complete Sun–Sat week): handle, global gmv_30d, store GMV this week, views this week, videos posted this week, orders, AOV.
20. **Top 10 videos by GMV posted this week**: creator handle, global gmv_30d, product name, GMV, views, orders, AOV, likes, comments, product clicks, publish date.
21. **This week's top 10 most active creators by videos posted**: handle, global gmv_30d, store GMV this week, views this week, videos posted, orders, AOV.
22. **GMV Max spend current 30d broken down by content age.** Buckets by video publish date vs the window end: "< 30 days", "1–2 months" (31–60 days), "2–3 months" (61–90), "3–5 months" (91–150), "5+ months" (151+), "Unknown post date" (missing). For each non-empty bucket: label, videos (count), spend, revenue, roi (revenue/spend, 0 if no spend), pct (spend % of total). Omit empty buckets. Output [] if GMV Max data unavailable.
23. **Outreach & CRM agents created in the last 30 days**: call list_outreach_agents with agentType="outreach" and agentType="crm", multiple searchQuery values ("", "L1"…"L7", "Video Volume", "GMV Contest", "New Agent"), limit=25, archived=false. Merge and dedupe by id, keep agents with created_time >= window start. Call get_outreach_agent for each to enrich. Map to: id, name, agent_type ("outreach"/"crm"), campaign_type, status (bot_status), date_posted (YYYY-MM-DD from created_time), gmv_filter (target_gmvs joined ", "; "none" if empty), kw_filter (target_categories joined ", "; "none" if empty), other_filters (summary of other non-empty target_* fields; "none" if all empty), list_segment (lists/segments names; "none" if absent), commission_display (unique commission rate; "none" if absent), creators_reached (total_conversations), remaining (remaining_creators), total_invites, accepted_invites, total_replies, samples_requested (total_sample_request), samples_shipped, total_videos, total_revenue, product_count (length of products array), has_followups.

## Analysis — write 4 focused sections after pulling all data

- **"performance"**: 3–4 paragraphs — this week's headline numbers (last complete Sun–Sat week), MTD progress vs monthly goal (state if on/off track and by how much), QTD progress vs quarterly goal, what's driving results. Be specific: name the creators/products/tiers moving the numbers. If the user hasn't shared goals, describe momentum vs prior periods instead.
- **"creators"**: 2–3 paragraphs — new creator breakouts (creators in their first 1–3 weeks already generating meaningful GMV: name them, their numbers, why they're exciting); top performing content this week (specific video + creator + GMV); which level is most active and most productive per creator; high-tier (L6/L7) activation pace.
- **"recruiting"**: 2–3 paragraphs — top reactivation targets (inactive creators with high global GMV who haven't posted recently: name them, their global GMV, last post timing); current outreach mix analysis (is the L3/L4 vs L5+ balance aligned with where GMV comes from?); sample allocation recommendations; concrete next-week recruiting actions.
- **"growth"**: 2–3 paragraphs — 13-week GMV trend direction and momentum; which tier/product/content format is the primary growth engine; 2–3 specific opportunities this week; 1–2 risks to monitor; 4-week forward outlook with upside and downside scenarios.

## Output

Respond with **ONLY this JSON object**, nothing before or after it. CRITICAL: include EVERY field shown below — never omit a field even if its query returned no data (use empty arrays [] or 0 as defaults). The fields gmvMaxByAge, agents, vwl1–vwl7, and level views are required even if empty:

```json
{
  "meta": {
    "reportDate": "YYYY-MM-DD",
    "label": "Month D, YYYY",
    "dataWindow": "Mon D – Mon D, YYYY"
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
  }
}
```

Table row formats:

- topCreators: `{ "h":"handle","flw":0,"sgmv":0,"ggmv":0,"views":0,"v30":0,"vmgmv":0,"vlife":0,"v7":0,"ord":0,"aov":0,"eng":null }`
- topVideos: `{ "h":"handle","ggmv":0,"prod":"product name","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":"Mon D" }`
- activeCreators: `{ "h":"handle","ggmv":0,"flw":0,"v30":0,"gmvN":0,"gmvT":0,"views":0,"avgv":0,"ord":0 }`
- weeklyTopCreators: `{ "h":"handle","ggmv":0,"gmv":0,"views":0,"vid":0,"ord":0,"aov":0 }`
- weeklyTopVideos: `{ "h":"handle","ggmv":0,"prod":"product name","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":"Mon D" }`
- weeklyActiveCreators: `{ "h":"handle","ggmv":0,"gmv":0,"views":0,"vid":0,"ord":0,"aov":0 }`
