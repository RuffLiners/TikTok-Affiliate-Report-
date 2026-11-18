# Automation: weekly Euka report (as built, Nov 18, 2026)

## Goal
Every Monday, with no manual step and no browser, GitHub Actions pulls Euka, builds the weekly report JSON in code, audits it, publishes it to the dashboard only on PASS, and emails a status line on every run. Claude writes only the six prose sections (four analysis sections plus the two re-engagement sections). Code produces every number.

## Why GitHub Actions only
Claude cloud scheduled tasks cannot reach `storage.googleapis.com` (Euka CSV exports) or the dashboard host and cannot write to this repo (verified Nov 16, 2026). GitHub Actions has the Euka token, `REPORT_PUBLISH_TOKEN`, `DASHBOARD_URL` and open network. Do not move any part of the build into a chat run.

## What runs
- Workflow: `.github/workflows/weekly-report.yml` ("Weekly report"), on the default branch `claude/friendly-gauss-AGnJ3`. Cron `37 16 * * 1` (Monday 10:37 CST / 11:37 CDT), plus `workflow_dispatch` with optional `report_date`. 60-minute job limit, report step 50 minutes, concurrency group `weekly-report`, `contents: read`, Node 22, Python 3.12.
- Entry point: `pipeline/src/weekly-report.ts` (`npm run weekly-report`). Status email: `pipeline/src/weekly-status.ts` (`npm run weekly-status`, runs with `if: always()`).
- Every step caches its raw result to `pipeline/.cache/<reportDate>/<step>.json` (CSV exports in `dl/`), so a re-run resumes. Each step retries 3 times; an HTTP 429 waits 60 seconds.
- The whole `.cache/<reportDate>/` folder (inputs, draft, report JSON, controls, `audit.txt`) is uploaded as the run artifact `weekly-report-<run id>`, kept 30 days.

## Steps
1. Windows (`weekly/windows.ts`, SKILL.md Phase 1, Pacific dates). A bad or future report date fails here, before anything is pulled or saved.
2. Scorecard check: reads `/api/publish-report` `latest`. Scheduled runs wait up to 20 minutes for today's scorecard, manual runs check once; then it continues and says `scorecard: NOT PUBLISHED TODAY` in the email.
3. Pulls (SKILL.md Phase 2): performance overview for 30 days (previous-period compare) and each of 6 months (guardrail fields kept; a 429 inside `shopGmvError` waits a minute, up to 3 times), retention summary, ads overview, level breakdown x21, `export_videos` x4 and `export_gmv_max_report` (creatives). CSVs are fetched with `fetch` and checked for their required columns. IDs stay text.
4. Agents: `list_outreach_agents` for outreach and crm, 25 a page, until a page is entirely older than the window start; `get_outreach_agent` for every in-window agent, mapped in `weekly/agents.ts`. A field that could not be read is `not enriched`, never `none`.
5. Build: `inputs.json` in the `references/inputs.example.json` format, `python3 -I py/build_report.py`, one `search_creators` call (100 handles per call) for the table handles, then the build again.
6. Re-engagement (spec v3.2): `tiktok-dashboard/src/lib/reengagement.ts`, shared with dashboard phase 26. Reads tags `RE `, `REACTIVATED `, `ROCIO L4+`, `ROCIO PERSONAL `, `ROCIO AGENT `, `WATCH L4+ Silent` (falls back to `WATCH L5+ Silent`), `WATCH first `, `In Discord`, the members carrying them (`list_members`, 100 a page) and the `<ISO-week> G<n> <name>` member lists with their linked agents. Phase 26 uses the same tag rules and writing rules from that module.
7. Analysis (`weekly/analysis.ts`): one Claude API call, no tools, `claude-opus-5-5` (override with `ANALYSIS_MODEL`), structured JSON output, server-side refusal fallback on. Input: the finished report, controls, derived facts (`weekly/derived.ts`: older-video share, concentration, GMV by product, new creators, inactive creators) and the re-engagement data. Every number in the derived facts and re-engagement data goes into `controls.derived_numbers`. Any dollar figure that does not trace to the data gets one re-prompt; still untraced fails the run. Em dashes are removed.
8. Audit: `python3 -I py/audit_report.py`. FAIL stops the run. WARN is allowed only for partial-month retention and agent enrichment gaps; any other WARN counts as FAIL. On FAIL the run drops the cached pulls the failure points at, rebuilds and re-audits once, then gives up. Numbers are never edited.
9. Publish (`publishReport()` in `pipeline/src/publish.ts`): `POST /api/publish-report` with `reportOnly: true`. The route checks the token and `audit.status === 'PASS'`, then calls `saveReportCore(report, 'scheduled-publish')`, which re-runs `validateGeneratedReport`, the review flags and reconciliation. It never touches the `scorecards` table. If it returns `needsReview`, the report is saved but the live page is not updated: PUBLISHED WITH REVIEW FLAGS.
10. Notify: status email every run (below). Slack only when the repo variable `SLACK_REPORT_POSTS=1` (unset since team Slack was paused Nov 16, 2026).

## Status email (contract; a Claude watchdog parses it)
The same subject and `key: value` lines are written to the run page (job summary) on every run. The email to brandon@ruffliners.com is sent only when the SMTP_* secrets are set (not set as of Nov 18, 2026, by choice); without them the email steps are skipped, not failed. Subject is exactly one of:
`Weekly TikTok report: PUBLISHED <reportDate>`, `Weekly TikTok report: PUBLISHED WITH REVIEW FLAGS <reportDate>`, `Weekly TikTok report: FAILED <reportDate>`.
Body, one `key: value` per line, every key always present, `none` when empty, list items joined with ` | `:
`reportDate`, `weekWindow`, `d30Window`, `d30Gmv`, `audit`, `auditFailures`, `warnings`, `reviewFlags`, `scorecard`, `failedStep`, `error`, `dashboardUrl`, `runUrl`.
The run writes a progress file at every step; a cancelled or timed-out run is sent as FAILED with `failedStep: unknown (run cancelled or timed out)` and the last step it was in under `error`. If even the status step cannot run, a static FAILED email with all keys is sent.

## Secrets
Existing: EUKA_MCP_URL, EUKA_BEARER_TOKEN, EUKA_STORE_ID, DASHBOARD_URL, REPORT_PUBLISH_TOKEN, SMTP_SERVER, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SLACK_WEBHOOK_URL. New: ANTHROPIC_API_KEY. Optional repo variable: SLACK_REPORT_POSTS.

## Tests
`cd pipeline && npm test` (windows, CSV IDs as text, status email builder and cancelled path, dollar tracing, agent mapping; runs in the workflow before the report). `cd tiktok-dashboard && npx vitest run` (the `reportOnly` route: 401, 422 on audit FAIL, 422 on server validation failure, 200 on the golden report; the shared re-engagement module).

## Scorecard
Unchanged and separate: `pipeline/src/run.ts`, `.github/workflows/weekly-scorecard.yml` (Monday 15:07 UTC) and `scorecard-daily.yml`. Its Python audit is `pipeline/py/audit_scorecard.py` (the older combined audit, kept because the org skill's `audit_report.py` no longer has the scorecard checks).
