---
name: affiliate-pulse-weekly
description: >
  Generate the weekly TikTok Shop affiliate growth report ("Affiliate Pulse")
  for any brand with the Euka connector attached. Pulls the last-30-days KPIs,
  13-week and 6-month trends segmented by creator level, GMV Max, outreach
  funnel, and retention, then writes four analysis sections (Performance,
  Creator highlights, Recruiting priorities, Growth outlook). Use whenever the
  user says "run my weekly report", "run affiliate pulse", "weekly TikTok Shop
  report", or asks to verify the Affiliate Pulse artifact's numbers. Requires
  the Euka MCP connector.
---

# Affiliate Pulse — weekly report skill

Companion to the Affiliate Pulse artifact. Uses the **same deterministic Euka
Dashboard API tools and the same window math**, so this skill's numbers and the
artifact's numbers must match; if they don't, something is wrong — investigate,
don't hand-patch.

Works for any brand: never hard-code brand names or IDs. Get them from
`list_accessible_brands`. If the account has multiple brands, ask which one.

## Phase 1 — Date windows (compute before any query)

```
TODAY       = date the report runs
GMV_END     = TODAY − 2 days          # 48–72h attribution lag
GMV_START   = GMV_END − 29 days       # inclusive 30-day window
PRIOR_END   = GMV_START − 1 day
PRIOR_START = PRIOR_END − 29 days
WEEK_END    = most recent Saturday ≤ GMV_END
WEEKS       = 13 complete Sun–Sat weeks ending WEEK_END (oldest first)
THIS_WEEK   = the last of WEEKS — the anchor for all analysis
MONTHS      = 5 complete calendar months + current partial month
              (1st → GMV_END), partial labeled with an asterisk, e.g. "Aug*"
```

State the exact windows in the report header.

## Phase 2 — Data pulls (Euka Dashboard tools only)

Use these tools — they are deterministic APIs, not the natural-language SQL
agent, so results are reproducible run to run:

| Data | Tool | Input |
|---|---|---|
| Brand list | `list_accessible_brands` | — |
| 30d KPIs + prior-period deltas | `get_dashboard_performance_overview` | `startDate=GMV_START, endDate=GMV_END` |
| 30d level breakdown L1–L7 | `get_dashboard_creator_level_breakdown` | `postedDateRange = 30d window` |
| Prior-30d level breakdown | same | `postedDateRange = prior window` (for per-segment % changes) |
| GMV Max | `get_dashboard_ads_overview` | `postedDateRange = 30d window` → spend, attributed revenue, orders; blended ROI = revenue ÷ spend |
| Outreach funnel | `get_dashboard_creator_outreach_funnel` | 30d window |
| Retention (30d) | `get_creator_retention_summary` | 30d window |
| Top 15 creators (30d) | `get_dashboard_top_creators_by_gmv` | 30d window, `limit=15` |
| Top creators this week | same | `postedDateRange = THIS_WEEK`, `limit=10` |
| Top videos | `get_dashboard_top_videos_by_revenue` | `filter.postedDateRange = 30d window` |
| Weekly trends | overview + level breakdown + retention summary **per week**, 13× | each Sun–Sat week |
| Monthly trends | overview + level breakdown + retention summary **per month**, 6× | each month window |

### Segment definitions (fixed — same as the artifact)

Group Euka levels by the creator's **platform-wide 30-day TikTok Shop GMV**:

- **Emerging** = L1 + L2 (under $25K)
- **Established** = L3 + L4 ($25K–$150K)
- **Power** = L5 + L6 + L7 ($150K+)

Segment GMV/creators/videos/invites/samples = sum of the member levels'
values from `get_dashboard_creator_level_breakdown`. Segment GMV is attributed
to videos posted in the period by that segment's creators. New-creator counts
come from the retention summary and exist only as totals (Euka does not expose
new creators per level) — never invent a per-level split.

## Phase 3 — Derived values

```
*Pct               = (current − prior) / prior × 100, 1 decimal; null if prior = 0
blended ROI        = adKpis.currentRevenue / adKpis.currentSpend
retention %        = retentionRate × 100 (already a fraction in the API)
GMV per creator    = segment GMV / segment creators-posting
MTD run rate       = month-to-date GMV / days elapsed × days in month
weekly labels      = Sun-date or week-ending date in M/D form, consistent
```

Sanity checks before writing anything:
- The three segments' GMV must sum to the level table's total GMV (they are
  the same rows regrouped — a mismatch means an arithmetic slip).
- `totalAffiliateGMV ≤ totalShopGMV` (shop GMV includes live/other channels).
- If a weekly value looks like an outlier, re-pull that one week before using it.

## Phase 4 — Write four analysis sections

Tone: senior analyst briefing the owner before Monday review — direct,
specific, real numbers and creator handles, no filler. Anchor on THIS_WEEK.

1. **Performance** — this week's GMV/orders/videos vs last week and vs the
   trailing average; MTD pacing (vs the user's goal if they state one); what
   specifically moved the number. Rules of interpretation:
   - Views down + GMV up = audience-quality improvement, never flag as a problem.
   - Paid boosting: new videos take 5–10 days of learning before spend ramps;
     an ROI target much above ~3.5× throttles spend and causes GMV dips that
     look organic.
2. **Creator highlights** — top creator and top video this week with numbers;
   any breakout (large positive delta on meaningful GMV); which segment was
   most active vs most productive per creator.
3. **Recruiting priorities** — outreach mix (messages/samples per segment) vs
   where GMV actually comes from; sample-to-post conversion; 2–3 concrete
   actions. Always apply the lag: outreach → posts in ~2–3 weeks → visible
   revenue in ~5–8 weeks; credit this week's GMV to outreach 4–6 weeks back.
4. **Growth outlook** — 13-week direction and inflections; which segment is
   the growth engine; retention vs the ~30% benchmark (below ~28% = churn
   outrunning the pipeline → prioritize reactivation); 4-week projection with
   an explicit upside and downside scenario.

## Output

A single report (dashboard-style if the surface supports visuals, otherwise
clean markdown): header with windows → 30-day KPI table with deltas → GMV Max
→ segment table (three segments + full L1–L7) → funnel + retention → weekly
and monthly trend summaries → top creators/videos → the four analysis
sections. End with one confirmation line:

```
✅ Affiliate Pulse ready: [Brand] · [GMV_START–GMV_END] · 30d affiliate GMV $[amount] · anchor week [THIS_WEEK]
```

## Verifying against the artifact

The Affiliate Pulse artifact computes everything above in the browser from the
same tools. To verify: open the artifact the same day (both use TODAY − 2), and
compare 30-day affiliate GMV, orders, segment GMV split, GMV Max spend/ROI, and
retention %. Small drift can appear only if the two runs happen on different
days or hours apart (attribution updates continuously) — same-day numbers
should match to the dollar.

## Error handling

| Problem | Resolution |
|---|---|
| No Euka tools available | Walk the user through adding the connector: claude.ai → Settings → Connectors → custom connector named "Euka", URL `https://app.euka.ai/api/mcp`. Never ask for API keys. |
| Multiple brands | Ask which brand; never guess. |
| A weekly/monthly pull fails | Retry once; if still failing, mark that period "unavailable" and say so — never interpolate. |
| Ads data empty | Brand may not run GMV Max — report spend/revenue/ROI as 0 and skip the paid analysis. |
| Retention previous-period zeros | First period on record — report the current rate without a delta. |
