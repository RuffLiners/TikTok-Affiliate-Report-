---
name: "ruff-liners-euka-json-report"
description: "Weekly TikTok Shop affiliate report for Ruff Liners from Euka, with the scorecard check and repair."
---

# Ruff Liners — Weekly Euka Report

Pulls KPI data from Euka, writes four analysis sections, runs a mandatory audit, and
outputs one JSON object for the Vercel dashboard. The brief Brandon pastes (date
windows, goal, schema) overrides anything here that conflicts with it.

**Method changed Nov 2026.** Euka removed the free-form `query_store_data` tool. The
brief still words its queries around `creator_store_performance`; ignore that wording
and use the structured dashboard tools and CSV exports below. Everything the brief
asks for is still produced. If `query_store_data` ever reappears, keep using this
method: it reconciles to the dashboard exactly and does not drift.

## Automated run (GitHub Actions, since Nov 2026)

The weekly report now builds itself. Workflow "Weekly report" (`.github/workflows/weekly-report.yml` in RuffLiners/TikTok-Affiliate-Report-, production branch `claude/friendly-gauss-AGnJ3`) runs every Monday at 16:37 UTC (10:37 AM Central in winter), after the scorecard and the Rocio and Alyssa tasks. It follows Phases 1 to 6 of this skill in code (`pipeline/src/weekly-report.ts`), calls Claude once for the prose, audits with `scripts/audit_report.py`, and publishes to the dashboard only on PASS. Details: `references/automation-build-brief.md`.

- **Email contract:** every run emails brandon@ruffliners.com with subject `Weekly TikTok report: PUBLISHED <date>`, `PUBLISHED WITH REVIEW FLAGS <date>` or `FAILED <date>`, and a body of `key: value` lines (reportDate, weekWindow, d30Window, d30Gmv, audit, auditFailures, warnings, reviewFlags, scorecard, failedStep, error, dashboardUrl, runUrl; `none` when empty).
- **Re-run:** GitHub > Actions > "Weekly report" > Run workflow. Leave `report_date` blank for today, or enter YYYY-MM-DD to rebuild a past Monday. A re-run of the same date resumes from the cached steps inside that run only; a new run pulls fresh.
- **Chat runs** of this skill are now the fallback, for when the workflow fails twice. Do not publish a chat-built report over a PUBLISHED one for the same date.

## Constants

```
BRAND_ID:  b4ec897a-fb59-48e7-9320-873ea5e25155   (every Euka tool below takes brandId)
STORE_ID:  455ea4f9-a404-411b-b748-9ba1929efb93   (appears in agent rows only)
```

Load tool schemas with ToolSearch (`select:mcp__https_app_euka_ai_api_mcp__<name>`).

## Creator levels (current global 30-day GMV)

L1 <$5K · L2 $5K–<$25K · L3 $25K–<$60K · L4 $60K–<$150K · L5 $150K–<$400K ·
L6 $400K–<$1.5M · L7 ≥$1.5M. Euka assigns each creator their **current** level, also
for past weeks and months. In the video export, tier `L0` or blank counts as L1
(population rule: never drop a row).

## Where each number comes from

| Metric | Source |
|---|---|
| gmv, level GMV (30d, weekly, monthly) | `get_dashboard_creator_level_breakdown` `totalGmv` (TikTok Shop Affiliate GMV by creator level). Totals are the level sums, so levels always reconcile |
| creators, videos by level | same tool: `activeCreators`, `videos` |
| msgs by level | same tool: `invitesSent`. Runs about 2× the dashboard headline `messagesSent` (Nov 2026: 561,246 vs 284,126). Different definitions; say so in the recruiting section |
| samples shipped / approved by level | same tool: `samplesDelivered` / `samplesApproved`. Both match the dashboard totals exactly |
| shopGmv, affiliateGmv | `get_dashboard_performance_overview` `totalShopGMV` / `totalAffiliateGMV`; % change from its `*Difference` fields. Guardrail: use shopGmv only when gmvFiltered === false AND filteredGmvUnavailable === false AND shopGmvError === null, else 0 |
| retention (30d) | `get_creator_retention_summary` `retentionRate` × 100, current and previous |
| views, new creators, weekly/monthly retention | computed from the lifetime video export (`export_videos`), Pacific dates. views = lifetime views of videos posted in the period. newCreators = handles whose earliest-ever store video falls in the period (matched the dashboard 235/330 exactly in Nov 2026) |
| orders, creator tables | `export_videos` with `kind: "commerceWindow"`: per-video GMV and items sold **earned in the window**. orders = sum of items sold |
| topVideos gmv | GMV earned in the 30-day window (commerceWindow), any post date. weeklyTopVideos = videos **posted** this week ranked by their GMV |
| vmgmv | videos posted in the window with GMV > 0 |
| gmvN / gmvT (activeCreators) | gmvN = window GMV from videos posted in the window; gmvT = the creator's total window GMV (same source as topCreators.sgmv) |
| GMV Max | `get_dashboard_ads_overview` for spend, revenue, daily rows; `export_gmv_max_report` dataset `creatives` for the age buckets |
| followers, engagement | `search_creators` with `filters.handles` |

Do not use `get_creator_activity_over_time` for the weekly charts: its weeks start on
Monday, the report's start on Sunday.

## Phase 1 — Date windows

Use the windows in the brief exactly. If none are given: the most recent complete
Sun–Sat week is "this week", 13 complete weeks ending on it, a 30-day window ending
on that Saturday plus the prior 30 days, and 6 months (5 complete plus the current
partial month through today, labelled with "*").

## Phase 2 — Pull (about 45 tool calls; run independent calls in parallel)

Work in a scratch folder. **Write each result to disk as soon as it returns**, so a
restart does not lose it. Level-breakdown responses can be saved verbatim.

1. `get_dashboard_performance_overview` for the current 30 days (default compare) and
   for each of the 6 months (`compareTo: {type: "none"}`). Keep the guardrail fields.
   If a month returns `shopGmvError` with HTTP 429, wait a minute and retry before
   falling back to 0 (Oct 2026 succeeded on the third try).
2. `get_creator_retention_summary` for the current 30 days.
3. `get_dashboard_ads_overview` for the current 30 days.
4. `get_dashboard_creator_level_breakdown` × 21: current 30d, prior 30d, each of the
   13 weeks, each of the 6 months.
5. `export_videos` × 4: `{kind: "lifetime", sort: postedAt desc}` plus `commerceWindow`
   for the current 30d, prior 30d and this week. Then `get_task_status` and
   `get_video_export_download_url` for each, and `curl` the files into `dl/`.
6. `export_gmv_max_report` (dataset `creatives`, current 30d), then
   `get_gmv_max_export_download_url`, and `curl` it into `dl/`.
7. Agents: `list_outreach_agents` once for `agentType: "outreach"` and once for
   `"crm"` (limit 25, archived false, empty searchQuery). Rows come newest first; page
   until a page's oldest `created_time` is before the window start. The keyword
   searches in the brief are subsets of this listing, so skip them. Keep agents with
   window start ≤ created date ≤ window end. Save id, name, campaign_type,
   bot_status, created date, has_followups and the metric fields.
8. Agent enrichment: `get_outreach_agent` for **each** kept agent (about 2.5K tokens
   each; 46 agents in Nov 2026). Hand this to one background subagent that writes a
   compact JSON file: gmv_filter (`target_gmvs`), kw_filter (`target_categories`),
   other_filters (other non-empty audience `target_*` fields, not `target_collab_*`),
   list_segment (names in `lists`, `legacyLists`, `segments`), commission_display
   (unique `product_commission_with_percentage` values, plus shop-ads rate when
   `include_shop_ads` is true), product_count. Truncate long list names for display.
   If enrichment can't be finished write "not enriched"; never write "none" for a
   field you didn't read.

## Phase 3 — Build

Write `inputs.json` (format: `references/inputs.example.json`; a level block can be
the raw tool response or 7 rows of `[activeCreators, videos, totalGmv, invitesSent,
samplesDelivered, samplesApproved]`), then:

```
python3 -I scripts/build_report.py inputs.json <out_dir>
```

It writes `draft.json` (meta, d30, weeklyCharts, monthlyCharts, tables) and
`controls.json`, and prints the handles that still need follower data. Call
`search_creators` once with those handles (`includeMatchedVideos: false`, pageSize =
handle count), add them to `inputs.json` under `creator_info` (`eng` =
`avg_video_engagement_30d` ÷ 100), and run the script again. Handles Euka can't find
keep followers 0 and engagement null; say which in the delivery note.

Rules the script applies, which the report must disclose when they fire:
- newCreators for a level is capped at that level's dashboard creator count.
- GMV Max spend with no creative row (the gap between the creative export and the
  ads-overview header, 9.2% in Nov 2026) goes to "Unknown post date".

Then add `agents` (listing + enrichment, newest first) and `analysis`, set
`controls.agents` to the in-window counts from the listings, and put every other
figure quoted in the analysis into `controls.derived_numbers`.

## Phase 4 — Analysis (four sections, \n\n between paragraphs)

Same section briefs as the weekly brief: performance (3–4 paragraphs), creators,
recruiting, growth (2–3 each). Tone: a senior analyst briefing the CEO. Name
creators, levels and amounts. No em dashes. Checks worth running for the analysis
(all from the exports): share of window GMV from videos posted before the window,
top-creator and top-3 concentration, GMV by product, creators whose first post is in
the last 3 weeks ranked by GMV, and inactive creators (last post > 30 days before
window end) ranked by global GMV and by lifetime store GMV.

- Say which GMV figure a pacing statement uses (dashboard shop vs affiliate vs creator-video). They differ.
- If the goal in the brief is labelled for another month, say so when applying it.
- A quarterly goal not given in the brief is an assumption; label it as one.
- Never attribute a creator's period GMV to videos that didn't convert. Check vmgmv and gmvN first.
- Ranges must include zero values in the data.
- Projections are estimates; label them as such.
- If no L6/L7 target is in the brief, say so instead of inventing one.

## Phase 5 — Assemble

Use the exact schema in the brief. Write the report as compact JSON to a file named
`ruff-liners-weekly-report-YYYY-MM-DD.json`.

## Phase 6 — Audit (mandatory; the report is not done until this passes)

1. `python3 -I scripts/audit_report.py <report.json> <controls.json>`
2. **If it prints FAIL:** fix the source or the build, never the number. Rerun until it passes.
3. **Manual checks the script can't do:** read each analysis sentence that states a count, %, rank or date and confirm it against the data.
4. **WARN lines are allowed** only if disclosed (partial-month retention, enrichment gaps).

## Phase 7: Scorecard check and repair (every run, after the audit passes)

The scorecard is not built by this skill. One engine owns it: the GitHub workflow
"Weekly scorecard" in RuffLiners/TikTok-Affiliate-Report- (code on the production
branch, folder `pipeline/`). It stores every week and month, pulls only periods that
are missing or not yet settled (14 days), always re-pulls the current partial month,
and publishes to the dashboard. This phase checks its output and gets gaps repaired.
**Never compute, type or correct a scorecard number here.** The only hand-entered
line is co-funded GMV, which is entered by hand (step 6).

Needs the dashboard signed in as admin and GitHub, so it runs in Claude in Chrome. If
neither is reachable, skip to "Report" and say "Scorecard: NOT CHECKED" with the reason.

1. **Run status.** GitHub Actions: latest run of "Weekly scorecard" and of "Scorecard
   daily snapshot and watchdog". Record conclusion, start time and run link. Never
   guess a status.
2. **Coverage.** Dashboard `/dashboard`, Scorecard card. Expected: every Sunday to
   Saturday week from the first full week of October 2025 through the last complete
   week, and every month from 2025-10 through the current month. List each expected
   week or month that is absent, and each line showing "no data" in a period where
   the lines around it have values.
3. **Manual gaps.** Open `/api/admin/scorecard-todo` and list the `cofunded` periods
   and the `spotCheck` month it returns. A 404 "No scorecard has been published yet"
   means the engine has never published: stop and report to Brandon that the
   scorecard setup is incomplete.
4. **Current month.** The Monthly tab must show the current month as month to date
   through yesterday (Pacific): days elapsed = yesterday's day of month. Recompute the
   month-end estimate for Gross Revenue, GMV and GMV Max spend as
   `month to date / days elapsed x days in month` and compare with the value shown.
   Over 1 percent apart, or days elapsed is stale, counts as a gap. Label the estimate
   as a straight-line estimate from the current daily average, not a forecast.
5. **Repair, at most one run per session.** If steps 1 to 4 found a missing or stale
   period, or the latest weekly run is not a success from today: Actions > "Weekly
   scorecard" > Run workflow, `force_refresh` OFF. Set `year_start` to `2025-10-01`
   only when weeks before January 1 of this year are missing; otherwise leave it
   blank. Wait for it to finish, then repeat steps 2 to 4. If the gap is still there,
   or the run fails, stop. Do not run it again and do not turn on `force_refresh`
   unless Brandon says so.
6. **Co-funded GMV.** If `cofunded` is not empty, list those periods in the report
   as still needed so Mina enters them by hand. There is no runbook skill for this
   step yet; do not enter the values yourself.
7. **Report.** Add to the delivery note and the #social-media post:
   `Scorecard: OK | REPAIRED | NEEDS ATTENTION | NOT CHECKED`, the run link, periods
   repaired, periods still missing, co-funded periods still needed, and the current
   month line: month to date, days elapsed of days in month, straight-line estimate.
8. **Alert.** If the status is NEEDS ATTENTION or NOT CHECKED, or either workflow's
   latest run failed, is stuck or never ran: email brandon@ruffliners.com with the
   subject "Scorecard needs attention: <short reason>", and post one message in
   #social-media starting with ":rotating_light:". Include what is wrong, the run
   links and the next step. One email and one alert post per run. If a send fails,
   say so at the top of the final answer.

## Delivery

**Always send the JSON as a file** (SendUserFile, or present_files where that exists).
Pasting from a rendered chat message breaks the JSON: the chat turns straight quotes
into curly quotes and eats underscores and asterisks, and the dashboard then reports
"Invalid JSON". If the brief says to reply with only the JSON, still send the file,
and put the JSON in the reply inside a fenced code block so it stays copyable.

Unless the brief forbids extra text, add:

```
Report ready: [LABEL] · GMV: $[d30.gmv] · Week of [WEEK_START]–[WEEK_END]
Audit: PASS · failures: 0 · Warnings: [list, or "none"]
Scorecard: [OK | REPAIRED | NEEDS ATTENTION | NOT CHECKED] · missing: [periods, or "none"] · [month] to date $[x], day [n] of [N], straight-line estimate $[y]
```

A report without `Audit: PASS` is a draft. When the brief allows only JSON, put the
data caveats in the analysis text instead.

## Known data limits (disclose when they apply)

- Product clicks aren't exposed (clicks = null).
- The video export differs from the dashboard by a few percent on video counts (deleted or late-synced videos), so creators/videos come from the dashboard and views/new creators from the export.
- Views keep accruing; the export's views total will sit slightly above the dashboard's retention-summary figure.
- Levels are current levels, so a creator who levelled up moves in every historical week.
- GMV Max revenue and affiliate GMV describe overlapping orders; never add them.