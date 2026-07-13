// CANONICAL METRIC DEFINITIONS for every prompt that asks Claude+Euka to build
// report numbers. query_store_data is a natural-language SQL agent that picks a
// different interpretation run-to-run unless each metric is pinned; every rule
// below was violated by an auto-run that the dashboard's reconciliation
// warnings then caught (e.g. tier GMV dropped evergreen videos, GMV Max header
// used total ad spend). These definitions mirror the "CRITICAL — determinism"
// block of the org's ruff-liners-euka-json-report skill (the canonical manual
// claude.ai run) — keep the two in sync when either changes.
export const CANONICAL_METRIC_DEFS = `
CANONICAL METRIC DEFINITIONS — authoritative; never substitute another interpretation:
- VIEWS = SUM(impressions) from creator_store_performance rows dated in the window. NOT creator_videos view counts, NOT lifetime cumulative views.
- ORDERS = SUM(items_sold_count) from creator_store_performance in the window, ALL attribution. Do NOT scope to videos posted in-window.
- AFFILIATE GMV = bare SUM(gmv) from creator_store_performance in the window. This is authoritative.
- SHOP GMV = get_dashboard_performance_overview field "totalShopGMV", only when gmvFiltered === false AND filteredGmvUnavailable === false AND shopGmvError === null; else 0.
- CREATORS = DISTINCT handles that POSTED a video in the window, deduped by handle (creators table has duplicate-handle rows). NEW CREATORS = first-ever post for this store falls in the window. NOT any-activity handles.
- RETENTION = (distinct handles that posted in BOTH the prior 30d window and the current window) / (distinct handles that posted in the prior window). Delta is current minus prior retention, in points.
- TIER GMV (l1-l7) = ALL GMV earned during the period from creator_store_performance, attributed to the earning creator's level — INCLUDING GMV from evergreen videos posted before the period. It is NOT limited to videos posted in-period. Levels from gmv_30d_num: L1 <5K, L2 5-25K, L3 25-60K, L4 60-150K, L5 150-400K, L6 400K-1.5M, L7 1.5M+; null or unmatched handle → L1. Dedup creators by handle BEFORE joining to prevent fan-out. The 7 levels MUST sum to the period's total affiliate GMV — request a totals row and verify before accepting. Same rule applies to tier views (sum to total impressions) and to the weekly/monthly per-tier series (sum to each week's/month's total). If it doesn't reconcile, re-run the query; never hand-patch.
- GMV MAX header (spend/revenue/roi) = GMV Max ad tables ONLY, same source as the content-age buckets, so header spend === sum of bucket spend. Do NOT use the dashboard's totalAdSpend for the header.
- MESSAGES = total outreach message EVENTS including follow-ups, not distinct creators messaged.
- HEAVY TIER QUERIES TIME OUT: run weekly-by-tier and monthly-by-tier as separate calls (posting columns, then views, then GMV; split GMV by month/half-range if needed).
- If a query returns 0 rows or claims 2026 is "in the future," retry stating year 2026 explicitly — the data exists.`
