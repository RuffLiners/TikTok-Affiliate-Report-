---
name: ruff-liners-scorecard-setup
description: Use Claude in Chrome to finish the one-time setup of the Ruff Liners scorecard (Supabase tables, Vercel and GitHub settings, first backfill run). Use when Brandon says "set up the scorecard", "finish the scorecard setup", or "run the first scorecard backfill". Secret values are typed by Brandon, never by Claude.
---

# Scorecard setup with Claude in Chrome

Load the `chrome-browser` skill first (open the person's tabs, work in a new tab, site permissions, stop conditions).

## The one rule that overrides everything
**Claude never reads, copies, types, screenshots, or repeats a secret value.** For every secret field: navigate to the field, then stop and say exactly "Please type <NAME> into the field and click Save, then tell me when it is done." Wait. Do not click "reveal", "show", or "copy" on any existing secret. Do not move a value from one page to another. If a secret appears on screen by accident, do not repeat it in any message.

Also: stop at any login, 2FA or captcha prompt and tell Brandon; never enter credentials. Change only what is listed here. Never delete, edit or rename an existing variable, secret, table or workflow. Never run a workflow not named here. Never set `force_refresh`.

## Values
Non-secret, Claude may enter:
| Name | Value |
|---|---|
| `EUKA_STORE_ID` | `455ea4f9-a404-411b-b748-9ba1929efb93` |
| `DASHBOARD_URL` | `https://tik-tok-weekly-dashboard.vercel.app` |
| `EUKA_MCP_URL` | the value of the existing `EUKA_MCP_URL` in the Vercel project's Environment Variables. If it is hidden, ask Brandon; do not guess. The default is `https://app.euka.ai/api/mcp` but the real one wins. |
| `SMTP_SERVER`, `SMTP_PORT`, `SMTP_USERNAME` | ask Brandon (the sending mailbox for failure emails to brandon@ruffliners.com) |

Secret, **Brandon types these**: `EUKA_BEARER_TOKEN`, `REPORT_PUBLISH_TOKEN`, `SMTP_PASSWORD`, `SLACK_WEBHOOK_URL`.
`REPORT_PUBLISH_TOKEN` must be the same value in Vercel and GitHub. Brandon generates it himself, for example `openssl rand -hex 32` in a terminal, and pastes it in both places. Claude never sees it.

## Order matters
### 1. Supabase tables
1. Open the repo file `setup-kit/supabase-schema.sql` on the `claude/friendly-gauss-AGnJ3` branch on GitHub and read from the line `-- 4. Scorecard (run this block on an existing project)` to the end of the file. (The statements are `create table if not exists`, so re-running is safe.)
2. Supabase > the project > SQL Editor > New query. Paste that block. Run it.
3. Verify: Table Editor lists `scorecards`, `scorecard_manual`, `scorecard_manual_log`, `scorecard_snapshots`, `scorecard_periods`, `scorecard_contest_months`, `scorecard_drift_log`. If any is missing or the run shows an error, stop and report the exact message.

### 2. Vercel
1. Vercel > the project > Settings > Environment Variables. Add `REPORT_PUBLISH_TOKEN`, scope Production. **Stop: Brandon types the value and saves.**
2. Deployments > the newest Production deployment > Redeploy (the variable does not apply until then). Wait for "Ready".
3. Verify: open `<DASHBOARD_URL>/dashboard`. The Scorecard card shows "No scorecard published yet". Open Manage; the Seller Center values panel loads with no error.

### 3. GitHub secrets
GitHub > the repo > Settings > Secrets and variables > Actions > New repository secret. Create each of these exactly as named:
- Claude enters: `EUKA_STORE_ID`, `DASHBOARD_URL`, `EUKA_MCP_URL`, `SMTP_SERVER`, `SMTP_PORT`, `SMTP_USERNAME`.
- **Brandon types:** `EUKA_BEARER_TOKEN`, `REPORT_PUBLISH_TOKEN`, `SMTP_PASSWORD`, `SLACK_WEBHOOK_URL` (a webhook bound to #social-media).
Verify: the secrets list shows all ten names. (GitHub never shows values; that is expected.)

### 4. Prove Euka access before the long run
Actions > "Euka auth probe" > Run workflow (branch `main`). It must finish green. If it fails with a token or auth message, stop and tell Brandon the token needs refreshing; do not continue.

### 5. First backfill
Actions > "Weekly scorecard" > Run workflow. Leave `force_refresh` OFF and `year_start` blank. It pulls the whole year and every month since launch, so it takes a while. The job times out at 60 minutes: if it is cancelled for time, run it once more (what was already saved is kept) and report both runs to Brandon. Do not start more than two runs.
Success looks like: the run is green, a summary appears in Slack #social-media, and `<DASHBOARD_URL>/dashboard` shows the Scorecard with a weekly and monthly view.

### 6. Only after step 5 succeeds
Actions > "Scorecard daily snapshot and watchdog" > Run workflow. (Run before step 5 it fails by design: the watchdog alerts that nothing has ever been published.)

## Report back to Brandon
For each step: done, or stopped and why, with the exact error text (never a secret). End with: Supabase tables present or not, Vercel redeploy ready or not, the ten GitHub secret names present or not, probe result, backfill result with run link, and the first things to look at on the dashboard. Then hand over to the `ruff-liners-scorecard-chrome` runbook for the co-funded GMV entry and the Seller Center spot-check. No em dashes.

## Limits to state
- Page layouts at Supabase, Vercel and GitHub change; if a button or label is not where this describes, stop and ask rather than guess.
- Claude in Chrome only works while Chrome is open and signed in. Setup is a one-time job; the Monday run itself is a GitHub cron and does not need Chrome.
