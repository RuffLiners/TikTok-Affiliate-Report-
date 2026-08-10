// CANONICAL METRIC DEFINITIONS for every prompt that asks Claude+Euka to build
// report numbers. query_store_data is a natural-language SQL agent that picks a
// different interpretation run-to-run unless each metric is pinned; every rule
// below was violated by an auto-run that the dashboard's reconciliation
// warnings then caught (e.g. tier GMV dropped evergreen videos, GMV Max header
// used total ad spend). These definitions mirror the "CRITICAL — determinism"
// block of the tiktok-weekly-report skill (skills/tiktok-weekly-report/SKILL.md,
// the canonical manual claude.ai run) — keep the two in sync when either changes.
// Spec version stamped into every saved report as d30.meta.promptVersion so
// spec drift between the skill copies and this pipeline is detectable from
// the output itself. Bump it whenever the prompts (or these definitions) change.
export const PROMPT_VERSION = '3.0'
export const CANONICAL_METRIC_DEFS = `
CANONICAL METRIC DEFINITIONS — authoritative; never substitute another interpretation:
- VIEWS = SUM(impressions) from creator_store_performance rows dated in the window. NOT creator_videos view counts, NOT lifetime cumulative views.
- ORDERS = SUM(items_sold_count) from creator_store_performance in the window, ALL attribution. Do NOT scope to videos posted in-window.
- AFFILIATE GMV = bare SUM(gmv) from creator_store_performance in the window. This is authoritative.
- SHOP GMV = get_dashboard_performance_overview field "totalShopGMV", only when gmvFiltered === false AND filteredGmvUnavailable === false AND shopGmvError === null; else 0.
- CREATORS = DISTINCT handles that POSTED a video in the window, deduped by handle (creators table has duplicate-handle rows). NEW CREATORS = first-ever post for this store falls in the window. NOT any-activity handles. Handles with NO match in the creators dimension (no gmv_30d) STILL COUNT in every metric — creators, new creators, videos, views, GMV — and bucket into L1; never drop them (LEFT JOIN, not inner join).
- RETENTION = (distinct handles that posted in BOTH the prior 30d window and the current window) / (distinct handles that posted in the prior window). Delta is current minus prior retention, in points.
- TIER GMV (l1-l7) = ALL GMV earned during the period from creator_store_performance, attributed to the earning creator's level — INCLUDING GMV from evergreen videos posted before the period. It is NOT limited to videos posted in-period. Levels from gmv_30d_num: L1 <5K, L2 5-25K, L3 25-60K, L4 60-150K, L5 150-400K, L6 400K-1.5M, L7 1.5M+; null or unmatched handle → L1. Dedup creators by handle BEFORE joining to prevent fan-out. The 7 levels MUST sum to the period's total affiliate GMV — request a totals row and verify before accepting. Same rule applies to tier views (sum to total impressions) and to the weekly/monthly per-tier series (sum to each week's/month's total). If it doesn't reconcile, re-run the query; never hand-patch.
- GMV MAX header (spend/revenue/roi) = GMV Max ad tables ONLY, same source as the content-age buckets, so header spend === sum of bucket spend. Do NOT use the dashboard's totalAdSpend for the header.
- MESSAGES = INITIAL outreach messages ONLY, deduped by message id — EXCLUDE follow-up messages. NOT total message events, NOT distinct creators messaged. Applies to every grain: 30d totals, per-tier msgs, weekly ml1-ml7, monthly ml1-ml7.
- SAMPLES (shipped) and SAMPLES APPROVED are both bucketed by the sample REQUEST's CREATED date in America/Los_Angeles — never ship date, never UTC — at every grain (30d, weekly sl*, monthly sl*, monthly sal*). APPROVED = the request moved past "To Review" and was not canceled.
- TIMEZONE = ALL date bucketing (video publish dates, Sun–Sat week boundaries, month boundaries, message dates, sample request dates) uses America/Los_Angeles, never UTC.
- HEAVY TIER QUERIES TIME OUT: run weekly-by-tier and monthly-by-tier as separate calls (posting columns, then views, then GMV; split GMV by month/half-range if needed).
- If a query returns 0 rows or claims 2026 is "in the future," retry stating year 2026 explicitly — the data exists.`
