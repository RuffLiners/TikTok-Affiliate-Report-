# Build brief: fully automated weekly Euka report

## Goal
The weekly report is produced and saved with zero manual steps, and nothing is saved unless the audit passes. The Claude model writes only the four analysis sections. Code does all data pulling, paging, bucketing, reconciliation and auditing.

## Why code, not chat
In the Oct 12, 2026 chat run, the GMV Max creative report had 1,000+ rows: 600 rows reached only 98.4% of spend, and the dashboard rejects anything under 99%. Agent enrichment needs ~40 more calls, and heavy queries time out.

## Architecture
- Runner: a GitHub Actions workflow on a Monday-morning cron (America/Chicago), plus workflow_dispatch for the dashboard button. Not a single Vercel function, which would exceed its time limit.
- Euka: the MCP SDK streamable HTTP client to EUKA_MCP_URL with EUKA_BEARER_TOKEN. Fallback, only with Brandon's OK: one Claude API call per page via mcp_servers, returning compact JSON rows.
- Storage: each step's raw result is cached by report date and step so a failed run resumes. The final report and audit output are saved to Supabase only on PASS.
- Analysis: one Claude API call (no tools) given the finished JSON, controls.json and the SKILL.md Phase 4 writing rules.
- Notify: Slack on PASS (confirmation and audit lines) and on FAIL (the failures and which step to re-run).

## Pipeline (one function per step, each with retries)
1. Windows: compute all dates (SKILL.md Phase 1, or the windows in the weekly brief).
2. Dashboard overviews: get_dashboard_performance_overview for the 30-day window and for each of the 6 months (7 calls). Apply the shop-GMV guardrail in code.
3. Ads overview: get_dashboard_ads_overview for the 30 days. Header spend = adKpis.currentSpend.
4. GMV Max by age: loop get_gmv_max_creative_report (pageSize 100) until hasMore === false. Bucket with bucket_gmvmax.py logic (publish date = itemId >> 32 as unix seconds; itemId -1 = "Unknown post date"). Fail if the buckets differ from header spend by more than $0.05.
5. query_store_data steps: use the question text in SKILL.md Phase 2, then read every row with read_sandbox_file (page with startLine/endLine).
   - On error 57014 or a stream timeout: retry 3×, then split the period in halves.
   - Validate every level split against its totals in code and re-run on mismatch.
   - Reject any result whose summary says it "reconciled" or "adjusted" values to match a target.
6. Agents: page list_outreach_agents for outreach and crm until the oldest created_time is before the window start. Call get_outreach_agent for every kept agent and map every field in the agent schema. No "not enriched" values.
7. Assemble the JSON (SKILL.md Phase 5). Build controls.json from raw step results, never from the report.
8. Analysis: make the Claude call, then audit check 9 (untraced dollar figures). Re-prompt once with the list; fail if anything is still untraced.
9. Audit: audit_report.py. WARN = FAIL, except partial-month retention.
10. Save to Supabase only on PASS, then notify.

## Dashboard changes
- The "Generate This Week's Report" button triggers the workflow via GITHUB_DISPATCH_TOKEN and shows run status.
- /admin/upload stays as a fallback and runs the same audit before saving. The existing 1% GMV Max check stays.
- Monthly ml1–ml7 can be null (no message data before Jul 2026). Charts show a gap instead of crashing.

## Acceptance test (report date 2026-10-12)
- gmvMaxByAge spend equals the same run's ads-overview spend (±$0.05) after paging to hasMore === false. Also report the difference from $132,393.37.
- Monthly level posting arrays sum to the monthly totals for all 6 months.
- 31 outreach and 8 CRM agents in the window, all fully enriched.
- The audit prints PASS (only the partial-month retention warning is allowed).
- The report saves to the dashboard with no manual step.
