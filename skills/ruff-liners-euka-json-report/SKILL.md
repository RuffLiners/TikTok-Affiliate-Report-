---
name: ruff-liners-euka-json-report
description: Build, audit and publish the Ruff Liners weekly scorecard from Euka's typed tools. Use when Brandon or the VA says "run the weekly report", "run the Monday report", "generate the scorecard", "audit the report", or the scheduled Monday run fires. Requires the Euka MCP. Nothing is published unless both audits pass.
---

# Ruff Liners weekly scorecard

The Monday run is code (`pipeline/`, GitHub Actions). This skill is the spec the code follows and the manual fallback. Never edit a number by hand: if an audit fails, fix the source pull and re-run.

## The 14 lines and where each comes from
brandId `b4ec897a-fb59-48e7-9320-873ea5e25155`, storeId `455ea4f9-a404-411b-b748-9ba1929efb93`. Dates are America/Los_Angeles. Weeks run Sunday to Saturday.

| # | Line | Source | Real history |
|---|------|--------|--------------|
| 1 | TikTok Gross Revenue (Seller Center Ads "Gross revenue", co-funded basis) | `get_dashboard_ads_overview` daily `revenue` | 2025-10-28 |
| 2 | TikTok GMV (Seller Center Shop analytics "GMV") | `get_dashboard_performance_series` `total_shop_gmv`, equals overview `totalShopGMV` | TikTok retention window only |
| 3 | GMV with TikTok co-funding | **Manual or CSV import only.** No Euka field returns it | whatever is entered |
| 4 | GMV Max Spend | `get_dashboard_ads_overview` daily `cost` | 2025-10-28 |
| 5 | GMV Max ROI = line 1 / line 4 | computed, never averaged or summed | 2025-10-28 |
| 6 | Target Collab invites sent | series `analyticsAggregated.target_invites` | see "Known gaps" |
| 7 | Euka Chat messages sent | team-sent messages (`senderType` Manager) in Euka Chat conversations (`list_inbox_threads` channel `CreatorAppChat` + `list_inbox_thread_timeline`), counted by Los Angeles day. NOT the outreach `messages_sent` (TikTok Shop DMs). | first Euka Chat message |
| 8 | Emails sent | series `analyticsAggregated.emails_sent` | see "Known gaps" |
| 9 | Free samples approved | `get_dashboard_performance_overview.samplesApproved` | retention window |
| 10 | Creators posted (distinct) | overview `activeCreators` | retention window |
| 11 | Affiliate videos posted | series `videoPosted.videos_posted` | 2025-10 |
| 12 | Views | overview `allAccountVideoViews` | 2026-01 (Euka returns 0 earlier: shown as no data) |
| 13 | Affiliates in monthly contest (distinct per calendar month) | `list_contests` + `get_contest` participants, contests only, stored by month | first contest month |
| 14 | Affiliates with usage rights (distinct creators) | `search_usage_rights_requests` states=active, archived=include, distinct `creator.id` | first daily snapshot |

Also shown: **ROI vs shop GMV** = line 2 / line 4. Gross Revenue is on TikTok's co-funded basis, so it can exceed shop GMV; that is expected and is noted as an info issue, not an error.

## Rules that never bend
- A source `null` is "no data". It is never 0, in any line, in any period.
- A period with any missing day in a daily series is "no data", not a partial sum.
- Ratios (ROI) are recomputed from numerator and denominator, never averaged.
- Distinct-people lines (10, 13, 14) are never summed across periods and never projected.
- Monthly projection (current month only): `(month to date / days elapsed) x days in month`, labelled "straight-line estimate", recomputed every report. Projected ROI = projected revenue / projected spend.
- Lines 1, 2, 4 to 12 come from Euka. Manual or imported values fill only periods Euka cannot reach (before its retention window), and never override Euka.

## Controls (must reproduce)
Week Nov 1 to 7 2026: shop GMV 51,830.97 | affiliate GMV 43,690.29 | LIVE GMV 729.09 | orders 400 | GMV Max spend 18,083.48 | GMV Max revenue 59,831.31 | ROI 3.31 | ROI vs shop GMV 2.87 | messages 68,180 | samples approved 30 | creators posted 108 | videos 572 | views 2,400,982. Seller Center co-funded GMV for that week: 61,492.68 (manual line).
Controls for the audit are built from range-level tools (`get_dashboard_performance_overview`, `get_dashboard_ads_overview`), independent of the daily series the report is assembled from. See `pipeline/py/controls.example.json`.

## Storage: pull once, keep it
Every completed week and month is stored in `scorecard_periods` (Supabase) after both audits pass. A period is **final** 14 days after it ends (TikTok's numbers settle); final periods are reused and never pulled again. A run pulls only: periods not stored yet, periods inside the 14-day settle window, the current month to date, and anything invalidated by a bump of `RAW_VERSION` in `pipeline/src/plan.ts`. The daily series is fetched only for the days those periods cover. A pull that hit an error is never marked final. All-time is the sum of the stored months. Usage-rights history comes from daily snapshots in `scorecard_snapshots`.
- **First run (backfill):** nothing is stored, so it pulls the whole year plus every month since launch. Run "Weekly scorecard" by hand; set `year_start` to reach further back than Jan 1.
- **Every later run:** pulls about 4 periods.
- **Repair:** run with `force_refresh` to ignore stored data. Changing a line definition: bump `RAW_VERSION`.
- Stored data is a frozen copy. If TikTok restates a number after the 14-day window, use `force_refresh` to pick it up.

## Restatement check (is the stored past still right?)
TikTok can revise a settled period (refunds, late attribution). Every run re-pulls the 2 newest final weeks and the newest final month and compares them with what is stored (money tolerance: the larger of $1 or 0.1 percent; counts: 0.1 percent, so 572 vs 573 videos is a change). Clean: stop. Any change: re-pull the last 3 months and compare; still changing: the last 6 months; still changing: full history. Each stage is only reached if the one before found drift, and the run stops at the first clean stage. Changed values replace the stored ones and every change is logged in `scorecard_drift_log` and listed in the Slack message. Drift that reaches full history is a warning to review. Tolerances are in `pipeline/src/drift.ts`.

## Contests
A contest belongs to the month it starts in. A creator in several of that month's contests counts once for the month. Retainers and canceled contests are excluded. Finished months (all contests completed and ended 14+ days ago) are stored with their participant ids in `scorecard_contest_months` and never re-pulled; all-time is the distinct union across stored months. Months before the first contest show no data; a later month with no contest shows 0.

## Steps
1. Windows: `weekRanges(asOf, 13)`, `monthRanges(dataThrough)` in `tiktok-dashboard/src/lib/scorecard/periods.ts`. dataThrough = yesterday.
2. Pull (`pipeline/src/pull.ts`): daily series in 31-day chunks, range-level overview per week and month, contests, usage rights.
3. Build: `buildScorecard(raw, manualEntries)`.
4. Audit twice: `auditScorecard` (TypeScript) and `python3 pipeline/py/audit_report.py report.json controls.json`. Both must say PASS. On FAIL: drop the cache, re-pull from source once, re-audit. Still failing: stop, alert, publish nothing.
5. Publish: `POST $DASHBOARD_URL/api/publish-report` with `Authorization: Bearer $REPORT_PUBLISH_TOKEN`. The server rejects any report whose `audit.status` is not PASS and re-audits independently.
6. Slack #social-media: dashboard link, audit result, warnings, and the issues list (unconfirmed Seller Center lines and every open item).
7. On failure, stuck or drift: Slack plus an email to brandon@ruffliners.com (workflow `if: failure() || cancelled()` and the daily watchdog).

## Seller Center spot-check
Monthly, on the latest complete month: Gross Revenue, GMV, GMV Max spend, ROI. Enter the Seller Center values in Manage > Scorecard (type "Monthly spot-check"). Euka vs Seller Center difference and percent are stored in `scorecard.sellerCenterCheck`; anything over 2 percent becomes a warning issue.

## Known gaps (state these, never hide them)
- Daily messages, invites and emails exist from at least June 2026 and are empty for Oct 2025. The exact first day is found by the pull: earlier periods show no data.
- Euka's content overview counts 593 videos for the control week; the performance overview and series count 572. The scorecard uses 572.
- `list_email_campaigns` and `list_outreach_agents` give lifetime counters only. They are not used for weekly values and have not been reconciled to the daily series.
- Usage-rights history has no dated source: it starts at the first daily snapshot.
- The legacy dashboard sections (tiers, creator tables, GMV Max by age, agents) are not rebuilt on typed tools yet.
