---
name: ruff-liners-euka-json-report
description: >
  Pull all Ruff Liners TikTok Shop KPI data from Euka, write four focused analysis
  sections, and output a complete JSON object for the Ruff Liners weekly dashboard.
  Use this skill whenever Brandon or the VA says "run the weekly Euka report",
  "generate the weekly report", "pull this week's data", "run the Monday report",
  "generate the dashboard report", or any variation. Requires Euka MCP connected.
  Outputs one JSON block — nothing else. The companion skill
  ruff-liners-tiktok-dashboard handles in-Claude interactive visualization;
  this skill handles structured data extraction for the Vercel dashboard app.
---

# Ruff Liners — Weekly Euka Report Skill (spec v3.0)

Pulls all KPI data from Euka across 23 queries, writes four business-focused
analysis sections, and outputs a single JSON object for the Ruff Liners TikTok
Shop weekly dashboard (Vercel app backed by Supabase).

**This file is generated from `tiktok-dashboard/prompts/master-prompt-v3.md`
in the dashboard repo — the single source of truth. Never edit this copy
directly; edit the master, bump its version, and regenerate.** The output
stamps `meta.promptVersion: "3.0"` so the dashboard can detect stale copies.

**Output:** One JSON block — `meta`, `d30`, `weeklyCharts`, `monthlyCharts`,
`tables`, `agents`, `analysis`, `validation`. Nothing before or after it
except the confirmation line.

---

## Constants

```
STORE_ID:       455ea4f9-a404-411b-b748-9ba1929efb93
EUKA_MCP:       https://app.euka.ai/api/mcp
PROMPT_VERSION: 3.0
TIMEZONE:       America/Los_Angeles  (syncs with TikTok Shop reporting)
```

---

## Canonical metric definitions — authoritative, never substitute another interpretation

`query_store_data` is a natural-language SQL agent and will pick a DIFFERENT
interpretation of an ambiguous metric on different runs. Every metric below is
pinned; if a returned value contradicts a definition, re-run — never accept it,
never hand-patch.

- **TIMEZONE** — ALL date bucketing (video publish dates, Sun–Sat week
  boundaries, month boundaries, message dates, sample request dates) uses
  **America/Los_Angeles**, never UTC.
- **VIEWS** = `SUM(impressions)` from `creator_store_performance` rows dated in
  the window. ⚠️ **This changed in v3**: older copies of this skill said to use
  `creator_videos.views_count` — that is wrong now. Impressions is the
  dashboard's canonical views metric at every grain (30d, per-tier, weekly,
  monthly).
- **ORDERS** = `SUM(items_sold_count)` from `creator_store_performance` in the
  window, ALL attribution. Never scoped to videos posted in-window.
- **AFFILIATE GMV** = bare `SUM(gmv)` from `creator_store_performance` in the
  window. Authoritative.
- **SHOP GMV** = `get_dashboard_performance_overview` → `totalShopGMV` (and
  `totalAffiliateGMV` → `affiliateGmv`, `totalShopGMVDifference` → `shopGmvPct`,
  `totalAffiliateGMVDifference` → `affiliateGmvPct`). GUARDRAIL: only use these
  when `shopGmvError === null` AND `gmvFiltered === false` AND
  `filteredGmvUnavailable === false`; otherwise output 0.
- **CREATORS** = DISTINCT handles that **posted a new video** in the window
  (publish date in window, LA time), deduped by handle — the creators table has
  duplicate-handle rows. Any-activity handles do NOT count. Handles with no
  match in the creators dimension STILL COUNT in every metric and bucket into
  L1 — LEFT JOIN, never drop them.
- **NEW CREATORS** = handles whose first-ever post for this store falls in the
  window.
- **VIDEOS** = videos published in the window, deduped by video id.
- **RETENTION** = (distinct handles that posted in BOTH the prior window and
  the current window) ÷ (distinct handles that posted in the prior window),
  as a **percent 0–100** with one decimal (28.0, never 0.28). Delta = current −
  prior, in points. Retention is about posting creators only — it says nothing
  about buyers or repeat customers.
- **CREATOR LEVELS** = Euka levels from the creator's global `gmv_30d_num`
  (their overall TikTok GMV across all stores):
  **L1** <$5K · **L2** $5–25K · **L3** $25–60K · **L4** $60–150K ·
  **L5** $150–400K · **L6** $400K–1.5M · **L7** $1.5M+.
  Null or unmatched handle → L1, for ALL metrics.
- **TIER GMV / TIER VIEWS (l1–l7)** = ALL GMV/impressions earned in the period
  from `creator_store_performance`, attributed to the earning creator's level —
  **including evergreen videos posted before the period** and creators who
  didn't post in it. Tier creators/newCreators/videos count only in-window
  posters. Dedup by handle BEFORE joining (join fan-out has inflated tiers past
  100% of total in past runs). L1+…+L7 MUST sum to the period totals — request
  a totals row and verify before accepting; re-run if off.
- **GMV MAX header** (spend/revenue/roi) = the GMV Max ad tables ONLY — the
  same video-level source as the content-age buckets, so header spend === sum
  of bucket spends. **Never** `get_dashboard_ads_overview.totalAdSpend` (it
  includes non-GMV-Max spend). GMV Max data exists only from 2026-05-14; use 0
  before that.
- **MESSAGES** = INITIAL outreach messages only, deduped by message id —
  EXCLUDE follow-ups. Not total message events, not distinct creators messaged.
  Applies at every grain (30d, per-tier, weekly ml*, monthly ml*).
- **SAMPLES** (shipped) and **SAMPLES APPROVED** = bucketed by the sample
  **request's CREATED date** (LA time) — never ship date. APPROVED = moved past
  "To Review" and not canceled.
- **ggmv** in tables = the creator's **global** `gmv_30d_num` from the creators
  dimension — never this store's GMV, never the video's GMV. Same column in
  every table.
- **eng** = engagement RATE percent ((likes+comments+shares) ÷ views × 100);
  null if only raw counts exist — never a raw count.
- **vmgmv** = count of this creator's videos for this store with ANY GMV in the
  window regardless of publish date (evergreen counts; usually ≥ v30).
- Always state year 2026 explicitly in queries; if a query returns 0 rows or
  claims 2026 is "in the future", retry stating 2026 — the data exists.
- Read every CSV Euka returns with `read_sandbox_file` — never rely on summary
  text. Paginate truncated files with startLine/endLine.
- **NEVER fabricate a value.** If a query fails after retries, output 0 (or []
  / null per the schema) and record it in `validation.flags` — a zero with a
  flag is recoverable; an invented number poisons the dashboard.

---

## Business context (for the analysis sections)

**Products:** Back Seat Extenders, XL Floor Covers, Travel Dog Beds.

**Level economics:** L1–L2 are emerging creators (high churn, low per-creator
GMV); L3–L4 are the proven mid-tier backbone; L5–L7 are power sellers and the
primary growth engine — per-creator GMV rises steeply with level.

**GMV Max learning phase:** new videos enter GMV Max in a 5–10 day learning
phase before spend ramps. `gmvT` exceeding `gmvN` is GMV Max boosting evergreen
content, not a data problem.

**Views vs GMV divergence:** lower views + higher GMV usually means the creator
mix is shifting toward higher levels with commercially-intent audiences — never
flag a views drop as a problem if GMV is growing.

**GMV Max ROI throttle:** an ROI target above 3.5× throttles spend to near zero
within days, creating a GMV dip that looks organic but is a paid-ads issue.

**Recruiting lag:** messages → creator posts ~2–3 weeks later → learning phase
5–10 days → revenue visible ~5–8 weeks after first contact. Look back 4–6
weeks to explain current creator activity.

**Retention benchmark:** ~30% monthly; below 28% signals churn exceeding new
pipeline value.

---

## Phase 1 — Compute date windows (America/Los_Angeles)

```
TODAY        = run date in America/Los_Angeles
REPORT_DATE  = TODAY as YYYY-MM-DD
GMV_END      = TODAY − 2 days          (attribution lag)
GMV_START    = GMV_END − 29 days
PRIOR_END    = GMV_START − 1 day
PRIOR_START  = PRIOR_END − 29 days
WEEK_END     = most recent Saturday ≤ GMV_END
WEEK_START   = WEEK_END − 6 days       ("this week" in all analysis)
WEEKS        = 13 Sun–Sat weeks ending WEEK_END, oldest first
MONTHS       = 5 complete calendar months + current partial month through TODAY
               (partial month labeled with asterisk, e.g. "Aug*")
```

Echo the windows back in the output: `meta.weekWindow = {start, end}` and
`meta.d30Window = {start, end}` — the dashboard verifies them.

---

## Phase 2 — Run the 23 queries

### 30-day KPIs
1. **Current 30d totals** (GMV_START–GMV_END): affiliate GMV, orders, views,
   creators, newCreators, videos, retention — per the canonical definitions.
   PLUS `get_dashboard_performance_overview` for the same window → shopGmv,
   shopGmvPct, affiliateGmv, affiliateGmvPct with the guardrail.
2. **Prior 30d totals** (PRIOR_START–PRIOR_END): same minus the shop fields.
3. **Current 30d by level** (l1–l7): creators, newCreators, videos, views, gmv
   per the TIER rule (evergreen GMV included; posting counts in-window only;
   unmatched → L1). Verify all five columns sum to the query-1 totals (GMV and
   views within 1%, counts exactly) before accepting.
4. **Current 30d outreach** by level + totals: msgs (initial only), samples
   (request-created date).
5. **Prior 30d outreach**: same.
6. **GMV Max current 30d**: spend, revenue, ROI from the GMV Max ad tables
   ONLY, plus spend/ROI by creator level.
7. **GMV Max by content age**: bucket each GMV-Max video by age at GMV_END —
   "< 30 days", "1–2 months" (31–60d), "2–3 months" (61–90d), "3–5 months"
   (91–150d), "5+ months" (151+d), "Unknown post date". Per bucket: videos,
   spend, revenue, roi, pct of total spend. Buckets must sum to the query-6
   header spend. Omit empty buckets; [] if unavailable.
8. **Outreach & CRM agents** created since GMV_START: `list_outreach_agents`
   with agentType "outreach" and "crm", searchQuery variations ("", "L1"–"L7",
   "Video Volume", "GMV Contest", "New Agent", "Tiktoktshopbonus"), limit 25,
   archived=false, botStatus ["running","stopped","error"]. Merge, dedup by id,
   keep created_time ≥ GMV_START. Enrich settings with ONE batched
   query_store_data over the campaign-settings table (id IN (...)); fall back
   to get_outreach_agent only for ids missing from the batch.

### 30-day tables
9. **Top 15 creators by store GMV**: h, flw, sgmv, ggmv, views, v30, vmgmv,
   vlife, v7 (videos posted WEEK_START–WEEK_END), ord, aov, eng.
10. **Top 15 videos by store GMV**: h, ggmv (creator's global — NOT the
    video's gmv; the two columns must differ), prod (shortened), gmv, views,
    ord, aov, likes, cmt, clicks (null if unavailable), date.
11. **Top 15 creators by videos posted**: h, ggmv, flw, v30, gmvN (GMV from
    in-window videos), gmvT (total store GMV in window), views, avgv, ord.

### 13-week charts (Sun–Sat, oldest first, exactly 13 rows each)
12. **Weekly GMV + orders** (13 rows).
13. **Weekly by level — posting**: creators, newCreators, videos per level per
    week; each week's L1+…+L7 must equal that week's posted totals.
14. **Weekly retention + videos/views**: retention as 13 plain percent numbers
    (never fractions, never objects); videos posted + views per week.
15. **Weekly outreach by level**: msgs + samples per level per week.
16. **Weekly by level — GMV + views**: per the TIER rule (evergreen included).
    PIN against queries 12/14: each week's L1+…+L7 GMV must equal that week's
    total GMV within 1%, views must equal that week's impressions within 1% —
    keep refining until every week reconciles. Split the range in half if slow.

### 6-month charts (oldest first, exactly 6 rows each)
17. **Monthly GMV**: affiliate gmv + views per month from
    creator_store_performance; shopGmv per month from
    get_dashboard_performance_overview with the guardrail. The current partial
    month runs through TODAY — do NOT cap at GMV_END.
18. **Monthly by level — posting**: creators, newCreators, videos; sums must
    equal each month's posted totals.
19. **Monthly retention + outreach**: retention as 6 percent numbers; msgs +
    samples + approved per level per month (approved → sal1–sal7).
20. **Monthly by level — GMV + views**: TIER rule, pinned to query 17's totals
    within 1% per month. Split by month if slow.

### This-week tables (WEEK_START–WEEK_END)
21. **Top 10 creators by store GMV this week**: h, ggmv, gmv, views, vid
    (posted this week), ord, aov.
22. **Top 10 videos POSTED this week by GMV**: h, ggmv, prod, gmv, views, ord,
    aov, likes, cmt, clicks, date.
23. **Top 10 most active creators this week** by videos posted: same shape as
    21, sorted by vid.

> **Heavy tier queries time out.** Run 13/16 and 18/20 as separate calls
> (posting columns first, then GMV+views); split GMV by half-range or by month
> if needed.

---

## Phase 3 — Compute derived values

```
*Pct fields    = (current − prior) / prior × 100, 1 decimal; null if prior = 0
retentionDelta = current − prior retention, in points
weekly labels  = Sunday date, M/D, no zero-padding ('3/1' not '03/01')
monthly labels = 3-letter month, asterisk on the partial ('Aug*')
```

## Phase 4 — Self-validate (V1–V12) before writing the analysis

Check every one; fix by re-querying, never by editing numbers. Report the
result in the output's `validation` object.

- V1 Σ tiers.gmv = d30.gmv (±1%) · V2 Σ tiers.views = d30.views (±1%)
- V3 Σ tiers creators/newCreators/videos = d30 totals (exact)
- V4 gmvMax.spend = Σ gmvMaxByAge spend (±1%)
- V5/V6 weekly gl1–7 and vwl1–7 sum to each week's gmv/views (±1%)
- V7 every weeklyCharts series has exactly 13 items; every monthlyCharts
  series exactly 6
- V8 no negative values anywhere
- V9 retention values on the percent scale (38.1, not 0.381)
- V10 d30.gmv > 0 · V11 no d30 metric moved more than ±60% vs the prior
  report without a known cause · V12 weeklyCharts.gmv is not all zeros

`validation.passed = true` only if all twelve hold; otherwise list each
failure in `validation.flags` and still output the report.

## Phase 5 — Write four analysis sections

Senior analyst briefing the CEO before Monday review — direct, specific, real
numbers, `\n\n` between paragraphs. Reference creators by handle, tiers as
L1–L7.

**FACT GUARDRAILS — these exact mistakes have shipped before:**
- Never conflate a % CHANGE with a % SHARE. Affiliate share of shop GMV =
  affiliateGmv ÷ shopGmv × 100. shopGmvPct/affiliateGmvPct are changes vs the
  prior window, never shares.
- RETENTION is posting-creator retention. It says nothing about buyers,
  repeat purchases, or customer LTV — never describe it in those terms.

1. **performance** (3–4 paragraphs): this week's headline numbers (the
   WEEK_START–WEEK_END Sun–Sat week); MTD pacing vs the monthly GMV goal — on
   or off track and by how much; QTD progress; the creators/levels/products
   driving results.
2. **creators** (2–3 paragraphs): new-creator breakouts by handle with
   numbers; top video this week (creator + GMV); most active vs most
   productive level; L6/L7 activation pace.
3. **recruiting** (2–3 paragraphs): named reactivation targets with global
   GMV; outreach mix vs where GMV actually comes from; sample allocation;
   concrete next-week actions.
4. **growth** (2–3 paragraphs): 13-week trend direction and momentum; current
   growth engine; 2–3 opportunities, 1–2 risks; 4-week outlook with upside
   and downside.

## Phase 6 — Output JSON

Output ONLY this JSON, fully populated. Include EVERY field — never omit one
because its query returned nothing (use 0 / [] / null defaults). The fields
`gmvMaxByAge`, `agents`, `vwl1–vwl7`, `sal1–sal7`, level views, and the three
weekly tables are required even if empty.

```json
{
  "meta": {
    "reportDate": "YYYY-MM-DD",
    "label": "Month D, YYYY",
    "dataWindow": "Mon D – Mon D, YYYY",
    "promptVersion": "3.0",
    "weekWindow": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "d30Window": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }
  },
  "d30": {
    "gmv": 0, "gmvPct": 0, "shopGmv": 0, "shopGmvPct": 0,
    "affiliateGmv": 0, "affiliateGmvPct": 0,
    "orders": 0, "ordersPct": 0,
    "videos": 0, "videosPct": 0, "views": 0, "viewsPct": 0,
    "creators": 0, "creatorsPct": 0, "newCreators": 0, "newCreatorsPct": 0,
    "retention": 0, "retentionDelta": 0,
    "gmvMax": { "spend": 0, "revenue": 0, "roi": 0 },
    "gmvMaxByAge": [],
    "msgs": 0, "msgsPct": 0, "samples": 0, "samplesPct": 0,
    "tiers": {
      "l1": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"gmvMaxSpend":0,"gmvMaxRoi":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "l2": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"gmvMaxSpend":0,"gmvMaxRoi":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "l3": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"gmvMaxSpend":0,"gmvMaxRoi":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "l4": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"gmvMaxSpend":0,"gmvMaxRoi":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "l5": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"gmvMaxSpend":0,"gmvMaxRoi":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "l6": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"gmvMaxSpend":0,"gmvMaxRoi":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "l7": { "creators":0,"newCreators":0,"videos":0,"views":0,"gmv":0,"gmvMaxSpend":0,"gmvMaxRoi":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 }
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
    "topCreators": [ { "h":"","flw":0,"sgmv":0,"ggmv":0,"views":0,"v30":0,"vmgmv":0,"vlife":0,"v7":0,"ord":0,"aov":0,"eng":null } ],
    "topVideos": [ { "h":"","ggmv":0,"prod":"","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":"" } ],
    "activeCreators": [ { "h":"","ggmv":0,"flw":0,"v30":0,"gmvN":0,"gmvT":0,"views":0,"avgv":0,"ord":0 } ],
    "weeklyTopCreators": [ { "h":"","ggmv":0,"gmv":0,"views":0,"vid":0,"ord":0,"aov":0 } ],
    "weeklyTopVideos": [ { "h":"","ggmv":0,"prod":"","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":"" } ],
    "weeklyActiveCreators": [ { "h":"","ggmv":0,"gmv":0,"views":0,"vid":0,"ord":0,"aov":0 } ]
  },
  "agents": [ { "id":0,"name":"","agent_type":"outreach","campaign_type":"","status":"running","date_posted":"YYYY-MM-DD","gmv_filter":"","kw_filter":"","other_filters":"","list_segment":"","commission_display":"","creators_reached":0,"remaining":0,"total_invites":0,"accepted_invites":0,"total_replies":0,"samples_requested":0,"samples_shipped":0,"total_videos":0,"total_revenue":0,"product_count":0,"has_followups":false } ],
  "analysis": {
    "performance": "3–4 paragraphs. Use \\n\\n between paragraphs.",
    "creators":    "2–3 paragraphs. Use \\n\\n between paragraphs.",
    "recruiting":  "2–3 paragraphs. Use \\n\\n between paragraphs.",
    "growth":      "2–3 paragraphs. Use \\n\\n between paragraphs."
  },
  "validation": { "passed": true, "flags": [] }
}
```

Product name shortening:
- "Hard Bottom Backseat Extenders for Dogs with Door Protection" → "Back Seat Ext."
- "XL Floor Cover for Full-Size Crew Cab Trucks with Fold Up Seats" → "XL Floor Cover"
- "Travel Dog Bed for Car" → "Travel Dog Bed"

---

## Confirmation line

```
✅ Report ready: [LABEL] · GMV: $[formatted] · Week of [WEEK_START]–[WEEK_END] · spec v3.0 · validation [passed | N flags]
```

---

## Delivery

**Primary:** VA clicks "Generate This Week's Report" at the dashboard `/admin`
page — the app runs the same spec server-side with server-computed dates.

**Fallback:** run this skill manually → copy the JSON → paste at `/admin`
Manual Entry. The dashboard re-validates on save either way.

---

## Error handling

| Problem | Resolution |
|---------|-----------|
| Query returns 0 rows / "2026 is in the future" | Retry explicitly stating 2026. If still empty, use 0/[] and add a validation flag. |
| GMV Max empty | Data starts ~2026-05-14. Use 0 for spend/revenue/roi, [] for gmvMaxByAge. |
| Tier sums don't reconcile | Evergreen GMV was dropped or duplicate handles fanned out. Re-run per the TIER rule (dedup by handle, LEFT JOIN, totals row). Never hand-patch. |
| Tier GMV exceeds period total | Definite fan-out — re-run deduped. |
| Weekly/monthly by-tier query times out | Split: posting columns first, then GMV+views; halve the date range if needed. |
| Retention arrives as 0.38-style fraction | Multiply by 100 — output percent scale. |
| Prior period = 0 | Set the Pct field to null. |
| Sandbox file truncated | Paginate with startLine/endLine. |
| Analysis too generic | Use actual numbers; name specific creators, levels, amounts. |
