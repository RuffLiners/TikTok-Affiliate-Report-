---
name: ruff-liners-scorecard-chrome
description: Use Claude in Chrome to read the Seller Center values the scorecard cannot get from Euka, enter them in the dashboard, and start the weekly scorecard run. Use when Brandon says "run the scorecard in Chrome", "enter the Seller Center numbers", "do the Monday scorecard entry", or the weekly entry reminder fires. Runs in the person's own signed-in Chrome.
---

# Weekly scorecard entry with Claude in Chrome

The ready-to-paste prompt for this runbook is in the dashboard: Admin > Manage tab > Scorecard backfill > "Copy prompt for Claude in Chrome" (shown after a finished run).

Load the `chrome-browser` skill first (open the person's tabs, work in a new tab, site permissions, stop conditions). This runbook says what to read, where to enter it, and when to stop.

## What is manual and what is not
Everything on the scorecard comes from Euka except **TikTok GMV with TikTok co-funding** (Seller Center Shop analytics, "Gross merchandise value (with TikTok co-funding)"). That line, plus a monthly spot-check, is the only thing entered by hand. Gross Revenue, GMV, spend and ROI are NOT entered: Euka matches Seller Center on them.

## Before you start
1. Seller Center and the dashboard (`/admin?tab=manage`) must both be signed in. If any shows a login, captcha or 2FA prompt, **stop and tell Brandon**. Never enter credentials.
2. Open `<dashboard>/api/admin/scorecard-todo`. It returns JSON listing exactly what is missing:
   - `cofunded`: weeks and months that need the co-funded GMV, each with `start` and `end`.
   - `spotCheck`: the month to spot-check and the four lines needed (Gross Revenue, GMV, GMV Max cost, ROI) with the Euka value beside each.
   - `history`: weeks and months where Euka has no history (TikTok GMV before 2026-05-22, Gross Revenue before 2025-10-28, Views before 2026-01-01), with the `lines` missing for each. Fill `gmv` and `grossRevenue` from Seller Center where it still has the data; skip `views` (Seller Center counts them differently).
   Enter only what is listed. If the list is empty, there is nothing to enter: go to "Start the run".

## Calibrate first (mandatory, once per session)
Seller Center Shop analytics, date range Nov 1 to Nov 7 2026: co-funded GMV must read **$61,492.68**. If it does not, the date range, time zone or metric is wrong. **Stop and report; enter nothing.** Also confirm the range label Seller Center shows matches the dates you selected.

## Read from Seller Center (read only)
- **Co-funded GMV:** Shop analytics, the metric labelled "Gross merchandise value (with TikTok co-funding)". For each `cofunded` item, set the date range to its `start` and `end` exactly and read the total.
- **Spot-check (the one month in `spotCheck`):** Shop analytics "GMV"; Marketing > Shop ads: "Gross revenue", cost and ROI, for that month.
- Do not click anything that changes Seller Center. Do not export or download.
- Copy the figure exactly as shown, digits only plus decimal point. If a figure is not visible, loading, or ambiguous, **leave it blank**. A blank is "no data", never 0. Never estimate, round, or infer from another number.

## Enter into the dashboard
Preferred, one batch:
1. Manage tab > Scorecard: Seller Center values > "One-time CSV import". Type your name in "Your name".
2. Paste CSV, one row per period:
   ```
   period_type,period_key,gmvCofunded
   week,2026-11-01,61492.68
   month,2026-10,265000.10
   month_check,2026-10,,
   ```
   For the spot-check use `period_type=month_check`, `period_key=<month>`, and columns `grossRevenue,gmv,gmvMaxSpend,gmvMaxRoi` (a separate CSV with that header). `week` keys are the Sunday start date; `month` keys are `YYYY-MM`.
3. Click **Validate only**. It must report the expected count and no errors. Then click **Import**.
Single values: use the form above the import box (Period type, Period, the field, Save values).

## Verify (never skip)
1. Reload `/api/admin/scorecard-todo`: the items you entered must be gone.
2. Reload `/dashboard`: the Scorecard Weekly and Monthly tabs show the values, with the "manual" chip.
3. If a spot-check line is over 2 percent from Euka, the Issues box says so. Report it to Brandon with both numbers. Do not "fix" either number.

## Start the run
Usually nothing to start: the scorecard runs by itself on Vercel every Monday at 15:07 UTC (retry at 17:07) and posts the summary in Slack #social-media. Manual Seller Center entries show on the dashboard as soon as they are saved; no run is needed for them.
To run it by hand: dashboard > Admin > Manage tab > "Scorecard backfill" > **Run backfill**. Leave "Re-pull everything" OFF unless Brandon said otherwise. Keep the tab open until it says Finished. If it fails, the panel shows the period, the error and the next step; report that text and stop. Click Resume once at most. Do not use the GitHub "Weekly scorecard" workflow: it is retired.

## Report back
Tell Brandon: items entered (count and periods), anything left blank and why, spot-check result and any flagged line, and, if a run was started by hand, its result. No em dashes. Do not paste credentials or session details.

## Limits to state
- Claude in Chrome only works while Chrome is open and signed in, and it is not a scheduler. Pair it with a reminder (a Claude scheduled task or calendar event) on Monday morning.
- Seller Center page labels and layout change. If a label is not exactly as above, stop and ask rather than choose a similar metric.
