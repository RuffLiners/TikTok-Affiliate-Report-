# Ruff Liners Weekly Report — Master Prompt Spec v3.0

**This file is the single source of truth for the weekly Euka report.**
Every other copy of the spec derives from it. If two copies disagree, this
file wins, and the divergent copy is a bug (this exact drift caused every
historical accuracy bug: fabricated tier GMV series, wrong views source,
missing schema fields).

| Derived artifact | Location | How it stays in sync |
|---|---|---|
| Auto-generate pipeline | `src/app/api/jobs/run/route.ts` (`PHASES` + `BASE`) and `src/lib/canonicalDefs.ts` | Hand-maintained; any change here requires a matching change there and a version bump |
| Version stamp | `PROMPT_VERSION` in `src/lib/canonicalDefs.ts` | Must equal the version in this file's title |
| Claude skill (user + org) | source: `prompts/SKILL-ruff-liners-euka-json-report.md` → installed as the `ruff-liners-euka-json-report` skill in claude.ai (user + org copies) | Regenerated from this file whenever the version bumps; paste the repo copy over both installed copies |
| Manual paste prompt | `setup-kit/weekly-report-prompt.md` (mirrored at `brand-kit/prompts/weekly-report-prompt.md`) | Regenerated from this file whenever the version bumps |
| White-label skill | `brand-kit/skills/tiktok-weekly-report/SKILL.md` | Same rules, brand-neutral |

**Change protocol:** edit this file → bump the version here and in
`PROMPT_VERSION` → mirror the change into the pipeline prompts → regenerate
the skill and manual prompt → run the golden-week test (`golden/README.md`).
Never edit a derived copy directly.

Every saved report carries `d30.meta.promptVersion` plus the exact windows
used (`d30.meta.weekWindow`, `d30.meta.d30Window`, `d30.meta.priorWindow`),
so drift is detectable from the output forever.

---

## 1. Date windows

All windows are **computed server-side** in `America/Los_Angeles` and injected
into prompts as literal dates. The model must never recompute them.

- `TODAY` = report run date, shifted to America/Los_Angeles first (Vercel runs UTC)
- `GMV_END` = TODAY − 2 days (Euka attribution lag)
- **Current 30d**: `GMV_END − 29` … `GMV_END`
- **Prior 30d**: the 30 days immediately before that
- **Last complete week**: most recent full **Sun–Sat** week ending on or before `GMV_END`
- **13 weeks**: the last 13 Sun–Sat weeks, chronological
- **6 months**: last 6 calendar months; the current month is partial (`*` label) and runs month-start … TODAY
- Monthly reports (`report_date` = `YYYY-MM-M`): current window is the calendar month capped at TODAY − 2; prior window is the full previous month

**All date bucketing — video publish dates, week/month boundaries, message
dates, sample request dates — uses America/Los_Angeles, never UTC.**

## 2. Canonical metric definitions

Authoritative — never substitute another interpretation. (Executable copy:
`CANONICAL_METRIC_DEFS` in `src/lib/canonicalDefs.ts`; both must match.)

- **VIEWS** = `SUM(impressions)` from `creator_store_performance` rows dated in the window. NOT creator_videos view counts, NOT lifetime cumulative views.
- **ORDERS** = `SUM(items_sold_count)` from `creator_store_performance` in the window, ALL attribution. Never scoped to videos posted in-window.
- **AFFILIATE GMV** = bare `SUM(gmv)` from `creator_store_performance` in the window. Authoritative.
- **SHOP GMV** = `get_dashboard_performance_overview` → `totalShopGMV`, **only when** `shopGmvError === null` AND `gmvFiltered === false` AND `filteredGmvUnavailable === false`; otherwise 0. (Same guardrail for `totalAffiliateGMV` → `affiliateGmv`.)
- **CREATORS** = DISTINCT handles that **posted a new video** in the window (publish date in window), deduped by handle — the creators table has duplicate-handle rows. Any-activity handles do NOT count. Handles with no match in the creators dimension STILL COUNT in every metric and bucket into L1 — LEFT JOIN, never drop them.
- **NEW CREATORS** = handles whose first-ever post for this store falls in the window.
- **VIDEOS** = videos published in the window, deduped by video id.
- **RETENTION** = (distinct handles that posted in BOTH the prior window and the current window) ÷ (distinct handles that posted in the prior window), expressed as a **percent 0–100** with one decimal (28.0, never 0.28). Delta = current − prior, in points. Retention is about **posting creators only** — it says nothing about buyers or repeat customers.
- **TIER GMV / TIER VIEWS (L1–L7)** = ALL GMV/impressions earned in the period from `creator_store_performance`, attributed to the earning creator's level — **including evergreen videos posted before the period** and creators who didn't post in it. Tier creators/newCreators/videos count only in-window posters. Levels from `gmv_30d_num`: L1 <$5K, L2 $5–25K, L3 $25–60K, L4 $60–150K, L5 $150–400K, L6 $400K–1.5M, L7 $1.5M+; null/unmatched → L1 for ALL metrics. Dedup by handle before joining. L1+…+L7 must sum to the period totals — request a totals row, verify, re-run if off. **Never hand-patch numbers.**
- **GMV MAX header** (spend/revenue/roi) = the GMV Max ad tables ONLY — the same video-level source as the content-age buckets, so header spend === sum of bucket spends. **Never** `get_dashboard_ads_overview.totalAdSpend` (it includes non-GMV-Max spend). GMV Max data exists only from 2026-05-14; use 0 before that.
- **MESSAGES** = INITIAL outreach messages only, deduped by message id — exclude follow-ups. Applies at every grain (30d, per-tier, weekly `ml*`, monthly `ml*`).
- **SAMPLES** (shipped) and **SAMPLES APPROVED** = bucketed by the sample **request's CREATED date** (America/Los_Angeles) — never ship date. APPROVED = moved past "To Review" and not canceled.
- **ggmv** in tables = the creator's **global** `gmv_30d_num` from the creators dimension (their overall TikTok GMV) — never this store's GMV, never the video's GMV.
- **eng** = engagement RATE percent ((likes+comments+shares) ÷ views × 100); null if only raw counts exist — never a raw count.
- **vmgmv** = count of this creator's videos for this store with ANY GMV in the window regardless of publish date (evergreen counts; usually ≥ in-window video count).

## 3. Query plan (23 queries → pipeline phases)

Each query is one pipeline phase (one Vercel invocation). All MCP phases
prepend the `BASE` header: store id, literal windows, canonical definitions,
JSON-only output rule, "always state year 2026", "read every CSV with
read_sandbox_file".

| # | Phase | Output key | Contents |
|---|---|---|---|
| 1 | Current 30d KPIs | `A1` | gmv, shopGmv(+pct), affiliateGmv(+pct) w/ guardrail, orders, videos, views, creators, newCreators, retention |
| 2 | Prior 30d KPIs | `A2` | same minus shop fields |
| 3 | 30d tier breakdown | `A3` | l1–l7 × creators/newCreators/videos/views/gmv, totals-row verified |
| 4 | Current 30d outreach | `A4` | total + l1–l7 × msgs/samples |
| 5 | Prior 30d outreach | `A5` | same |
| 6 | GMV Max | `A6` | spend/revenue/roi from GMV Max tables + per-tier spend/roi |
| 7 | GMV Max content age | `A7` | buckets <30d, 1–2m, 2–3m, 3–5m, 5+m, unknown — must sum to A6 spend |
| 8 | Outreach agents | `agents` | every outreach+CRM agent created in the window, enumerated past the 25-row cap, enriched via one batched settings query |
| 9 | Top 15 creators (30d) | `topCreators` | h, flw, sgmv, ggmv, views, v30, vmgmv, vlife, v7, ord, aov, eng |
| 10 | Top 15 videos (30d) | `topVideos` | h, ggmv, prod (shortened), gmv, views, ord, aov, likes, cmt, clicks, date |
| 11 | Most active creators (30d) | `activeCreators` | h, ggmv, flw, v30, gmvN, gmvT, views, avgv, ord |
| 12 | 13-week GMV+orders | `C1` | 13 rows |
| 13 | 13-week tier posting | `C2P` | l1–l7 × 13 × creators/newCreators/videos, totals-verified |
| 14 | 13-week retention+videos | `C3`,`C4` | 13 plain percent numbers; 13 × videos/views |
| 15 | 13-week outreach by tier | `C5` | l1–l7 × 13 × msgs/samples |
| 16 | 6-month GMV | `D1` | 6 × gmv/shopGmv(guardrailed)/views; partial month runs to TODAY |
| 17 | 6-month tier posting | `D2P` | like C2P, 6 rows |
| 18 | 6-month retention+outreach | `D3`,`D4` | 6 percents; l1–l7 × 6 × msgs/samples/approved |
| 21 | 13-week tier GMV+views | `C2V` | l1–l7 × 13 × gmv/views, **pinned** to C1/C4 totals (must sum within 1%) |
| 22 | 6-month tier GMV+views | `D2V` | l1–l7 × 6 × gmv/views, **pinned** to D1 totals |
| 23 | Week top creators | `weeklyTopCreators` | last complete Sun–Sat week, top 10 by store GMV |
| 24 | Week top videos | `weeklyTopVideos` | top 10 by GMV among videos POSTED in the week |
| 25 | Week most active | `weeklyActiveCreators` | top 10 by videos posted in the week |
| 19 | Analysis | `performance/creators/recruiting/growth` | four sections, strongest model, fact guardrails (share ≠ change; retention ≠ buyers) |
| 20 | Validate + save | — | assemble → validate → sanity-diff → upsert |

Phases 21/22 run only after their pinned totals (12/14, 16) have landed.
Phase 8 (agents) and 7 (content age) are optional — a failure records the
error and continues rather than killing the run.

## 4. Output contract

The assembled report row (`weekly_reports`):

- `report_date`, `label`, `data_window`
- `d30`: **`meta { promptVersion, weekWindow, d30Window, priorWindow, timezone, generatedAt }`**, gmv/gmvPct, shopGmv/shopGmvPct, affiliateGmv/affiliateGmvPct, orders/Pct, videos/Pct, views/Pct, creators/Pct, newCreators/Pct, retention/retentionDelta, gmvMax{spend,revenue,roi}, gmvMaxByAge[], msgs/Pct, samples/Pct, tiers.l1–l7 (creators, newCreators, videos, views, gmv, gmvMaxSpend?, gmvMaxRoi?, msgs/Pct, samples/Pct), goals snapshot, and — when flagged — `needsReview[]` + `reconciliation[]`
- `weekly_charts`: labels[13], gmv, views, crl1–7, ncl1–7, vl1–7, gl1–7, **vwl1–7**, ret (percent scale), vid, ml1–7, sl1–7 — every series exactly 13 items
- `monthly_charts`: labels[6], gmv, shopGmv (+legacy totalGmv), affiliateGmv, views, crl/ncl/vl/gl/vwl 1–7, ret, ml/sl 1–7, **sal1–7** — every series exactly 6 items
- `tables`: topCreators, topVideos, activeCreators, **weeklyTopCreators, weeklyTopVideos, weeklyActiveCreators**
- `agents`: array from phase 8
- `analysis`: `{performance, creators, recruiting, growth}` — paragraphs separated by `\n\n`

Percent-change fields are null (not 0) when the prior value is 0. Retention
values arriving as fractions are normalized ×100 at the boundary.

## 5. Validation (V1–V12)

Hard gate (`src/lib/validateReport.ts`) — failure re-pulls the offending
phases with the failure text appended (max 2 retries), then **rejects the
report; nothing is saved**:

- **V1** tier GMV: ΣL1–L7 = d30.gmv within 1%
- **V2** tier views: ΣL1–L7 = d30.views within 1%
- **V3** tier creators / newCreators / videos: sums match exactly
- **V4** GMV Max header spend = Σ age-bucket spend within 1%
- **V5** weekly per-tier GMV (gl1–7) sums to each week's total within 1%
- **V6** weekly per-tier views (vwl1–7) sums to each week's total within 1%
- **V7** every weekly series has exactly 13 items; every monthly series exactly 6
- **V8** no negative values in any series or 30d total
- **V9** retention on the percent scale (normalized at the boundary)

Sanity diff vs the prior report of the same type (`src/lib/sanityDiff.ts`) —
failure **saves the report flagged `needsReview`** with a banner and holds it
out of the live snapshot until a human confirms it:

- **V10** 30d affiliate GMV = $0
- **V11** any 30d metric (gmv, orders, videos, views, creators, newCreators, msgs, samples) moved more than ±60% vs the prior report
- **V12** weekly GMV series all zeros

Softer cross-checks (`src/lib/reconcile.ts`) still banner messages/samples
drift on any saved or pasted report.

## 6. Weekly run checklist (VA / Brandon)

1. `d30.meta.promptVersion` = **3.0**
2. No `needsReview` banner — or review and confirm each flag against Euka
3. Spot-check 3 numbers vs the Euka UI: 30d GMV, this week's top creator GMV, messages sent
4. `weekly_charts.gmv` has 13 elements; last element = this week's GMV
5. Diff vs last week: creators, newCreators, retention within plausible range
