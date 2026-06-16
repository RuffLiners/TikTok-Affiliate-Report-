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

QUERIES TO RUN (read every CSV file Euka returns):
1. Current 30d totals: GMV, orders, videos posted, views, creators posted, new creators (first-ever post for this store), retention rate vs prior period
2. Prior 30d: same totals for % change calculations
3. Current 30d by creator tier (G1 = global gmv_30d <$25K, G2 = $25K–$100K, G3 = >$100K): creators, new creators, videos posted, total views, store GMV — G1+G2+G3 views must sum to the overall 30d total views (do not leave views as 0)
4. Current 30d outreach by tier: messages sent + samples shipped + samples approved, plus overall totals
5. Prior 30d outreach: totals + by tier (for % change)
6. GMV Max current 30d: total ad spend, attributed revenue, blended ROI (use 0 if data unavailable before May 14 2026)
7. Top 15 creators by store GMV — handle, followers, store GMV, global gmv_30d, views, videos L30d, videos w/GMV L30d, lifetime videos, videos L7d, orders, AOV, engagement rate
8. For the top 15 handles from #7: count of videos that generated any GMV this period, and lifetime total videos for this store
9. Top 15 videos by store GMV — creator handle, product name, GMV, views, orders, AOV, publish date, likes, comments, product clicks
10. Top 15 creators by videos posted — handle, followers, GMV from new-period videos only, total store GMV, views, avg views/video, orders
11. 13 weekly totals: GMV, orders, views, videos (13 rows, one per Sun–Sat week)
12. 13 weeks by tier: creators posted, new creators, videos, views, store GMV per week per tier (39 rows) — include views per tier per week
13. 13 weeks: retention rate per week (13 rows)
14. 13 weeks: messages sent + samples shipped by tier per week (39 rows)
15. 6 months: for each month query its exact date range (current partial month goes through today — do NOT cap at the 30d end date). For each month: (a) affiliate GMV + views from creator_store_performance, (b) total account GMV (totalGmv) from get_dashboard_performance_overview — includes affiliate, product cards, in-house. Set totalGmv to 0 if unavailable. (6 rows)
16. 6 months by tier: creators, new creators, videos, views, GMV (18 rows) — include views per tier per month
17. 6 months: retention rate per month (6 rows)
18. 6 months: messages sent + samples shipped + samples approved by tier per month (18 rows; samples approved maps to sag1/sag2/sag3)
19. This week's top 10 creators by store GMV ([WEEK START]–[WEEK END]): handle, global gmv_30d, store GMV this week, views this week, videos posted this week, orders, AOV
20. Top 10 videos by GMV posted this week ([WEEK START]–[WEEK END]): creator handle, global gmv_30d, product name, GMV, views, orders, AOV, likes, comments, product clicks, publish date
21. This week's top 10 most active creators by videos posted ([WEEK START]–[WEEK END]): handle, global gmv_30d, store GMV this week, views this week, videos posted, orders, AOV
22. GMV Max spend current 30d ([START DATE]–[END DATE]) broken down by content age. Buckets by video publish date vs [END DATE]: "< 30 days" (posted in last 30 days), "1–2 months" (31–60 days old), "2–3 months" (61–90 days), "3–5 months" (91–150 days), "5+ months" (151+ days), "Unknown post date" (publish date missing). For each non-empty bucket: label, videos (count), spend, revenue, roi (revenue/spend, 0 if no spend), pct (spend % of total). Omit empty buckets. Output [] if GMV Max data unavailable.
23. Outreach & CRM agents created in the last 30 days ([START DATE]–[END DATE]): call list_outreach_agents with agentType="outreach" and agentType="crm", multiple searchQuery values ("", "G1", "G2", "G3", "Video Volume", "GMV Contest", "New Agent"), limit=25, archived=false. Merge and deduplicate by id, keep only agents with created_time >= [START DATE]. Call get_outreach_agent for each to enrich. Map to: id, name, agent_type ("outreach"/"crm"), campaign_type, status (bot_status), date_posted (YYYY-MM-DD from created_time), gmv_filter (target_gmvs joined ", "; "none" if empty), kw_filter (target_categories joined ", "; "none" if empty), other_filters (summary of other non-empty target_* fields; "none" if all empty), list_segment (lists/segments names; "none" if absent), commission_display (unique commission rate; "none" if absent), creators_reached (total_conversations), remaining (remaining_creators), total_invites, accepted_invites, total_replies, samples_requested (total_sample_request), samples_shipped, total_videos, total_revenue, product_count (length of products array), has_followups.

ANALYSIS — write 4 focused sections after pulling all data:
- "performance": 3–4 paragraphs — This week's headline numbers (last complete Sun–Sat week), MTD progress vs monthly goal (state if on/off track and by how much), QTD progress vs quarterly goal, what's driving results. Be specific: name the creators/products/tiers moving the numbers.
- "creators": 2–3 paragraphs — New creator breakouts: any creator in their first 1–3 weeks already generating meaningful GMV (name them, their numbers, why they're exciting). Top performing content this week (specific video + creator + GMV). Which tier is most active and most productive per creator. G3 activation pace vs target.
- "recruiting": 2–3 paragraphs — Top reactivation targets: inactive creators with high global GMV who haven't posted recently (name them, their global GMV, last post timing). Current outreach mix analysis (G2 vs G3 balance, is it aligned with where GMV comes from?). Sample allocation recommendations. Concrete next-week recruiting actions.
- "growth": 2–3 paragraphs — 13-week GMV trend direction and momentum. Which tier/product/content format is the primary growth engine right now. 2–3 specific opportunities to pursue this week. 1–2 risks to monitor. 4-week forward outlook with upside and downside scenarios.

OUTPUT — respond with ONLY this JSON object, nothing before or after it. CRITICAL: include EVERY field shown below — never omit a field even if its query returned no data (use empty arrays [] or 0 as defaults). The fields gmvMaxByAge, agents, vwg1/vwg2/vwg3, and tier views are required even if empty:

{
  "meta": {
    "reportDate": "YYYY-MM-DD",
    "label": "Month D, YYYY",
    "dataWindow": "Mon D – Mon D, YYYY"
  },
  "d30": {
    "gmv": 0, "gmvPct": 0, "orders": 0, "ordersPct": 0,
    "videos": 0, "videosPct": 0, "views": 0, "viewsPct": 0,
    "creators": 0, "creatorsPct": 0, "newCreators": 0, "newCreatorsPct": 0,
    "retention": 0, "retentionDelta": 0,
    "gmvMax": { "spend": 0, "revenue": 0, "roi": 0 },
    "gmvMaxByAge": [],
    "msgs": 0, "msgsPct": 0, "samples": 0, "samplesPct": 0,
    "tiers": {
      "g1": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "g2": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "g3": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 }
    }
  },
  "weeklyCharts": {
    "labels": [],
    "gmv":[],"views":[],
    "crg1":[],"crg2":[],"crg3":[],
    "ncg1":[],"ncg2":[],"ncg3":[],
    "vg1":[],"vg2":[],"vg3":[],
    "gg1":[],"gg2":[],"gg3":[],
    "vwg1":[],"vwg2":[],"vwg3":[],
    "ret":[],"vid":[],
    "mg1":[],"mg2":[],"mg3":[],
    "sg1":[],"sg2":[],"sg3":[]
  },
  "monthlyCharts": {
    "labels": [],
    "gmv":[],"totalGmv":[],"views":[],
    "crg1":[],"crg2":[],"crg3":[],
    "ncg1":[],"ncg2":[],"ncg3":[],
    "vg1":[],"vg2":[],"vg3":[],
    "gg1":[],"gg2":[],"gg3":[],
    "vwg1":[],"vwg2":[],"vwg3":[],
    "ret":[],
    "mg1":[],"mg2":[],"mg3":[],
    "sg1":[],"sg2":[],"sg3":[],
    "sag1":[],"sag2":[],"sag3":[]
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

Table row formats:
- topCreators: { "h":"handle","flw":0,"sgmv":0,"ggmv":0,"views":0,"v30":0,"vmgmv":0,"vlife":0,"v7":0,"ord":0,"aov":0,"eng":null }
- topVideos: { "h":"handle","ggmv":0,"prod":"product name","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":"Mon D" }
- activeCreators: { "h":"handle","ggmv":0,"flw":0,"v30":0,"gmvN":0,"gmvT":0,"views":0,"avgv":0,"ord":0 }
- weeklyTopCreators: { "h":"handle","ggmv":0,"gmv":0,"views":0,"vid":0,"ord":0,"aov":0 }
- weeklyTopVideos: { "h":"handle","ggmv":0,"prod":"product name","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":"Mon D" }
- weeklyActiveCreators: { "h":"handle","ggmv":0,"gmv":0,"views":0,"vid":0,"ord":0,"aov":0 }
