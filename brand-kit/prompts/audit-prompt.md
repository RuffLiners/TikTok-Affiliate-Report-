# Audit Prompt for Claude Code

Paste everything below the line into **Claude Code** opened in your kit folder (the folder containing `dashboard/`). Claude will audit your installation end-to-end and tell you whether your dashboard is working and reporting numbers exactly the way the reference implementation does. Run it after first setup, after any code change, and any time the numbers look off.

---

You are auditing a deployed **TikTok Affiliate Report Kit** — a Next.js dashboard (in `dashboard/`) that pulls TikTok Shop affiliate data from Euka via MCP, has Claude write analysis, stores reports in Supabase, and renders them on Vercel or locally. Your job is to verify this installation is (1) intact, (2) correctly configured, and (3) producing reports that conform **exactly** to the canonical reporting spec bundled with the kit. Do not fix anything until the end; first audit everything and collect findings.

Work through the five phases below in order. For each check record: PASS / FAIL / SKIPPED (with the reason). At the end, output the findings report described in Phase 5.

## Phase 1 — Code integrity (no deployment needed)

The kit ships with a single source of truth for how every metric is computed. Verify it is intact and internally consistent:

1. **Canonical definitions present**: `dashboard/src/lib/canonicalDefs.ts` exists, exports `CANONICAL_METRIC_DEFS` and `PROMPT_VERSION` (expected: `'3.0'`).
2. **Spec copies in sync**: the metric rules in `canonicalDefs.ts` must match, rule for rule, the "CRITICAL — determinism" section of `skills/tiktok-weekly-report/SKILL.md` and the definitions inside `prompts/weekly-report-prompt.md`. Compare them side by side: VIEWS, ORDERS, AFFILIATE GMV, SHOP GMV (with its three-condition guardrail), CREATORS/NEW CREATORS (dedup by handle, unmatched handles bucket to L1), RETENTION, TIER GMV (evergreen included, L1–L7 thresholds at $5K/$25K/$60K/$150K/$400K/$1.5M, tiers must sum to totals), GMV MAX header (ad tables only, equals sum of age buckets), MESSAGES (initial only, deduped), SAMPLES (bucketed by request created date), TIMEZONE (America/Los_Angeles everywhere). Any wording drift that changes meaning is a FAIL naming the exact rule.
3. **Validation gates present**: `dashboard/src/lib/validateReport.ts` (strict gate: tier sums, GMV Max header vs buckets, weekly per-tier sums, series length/negative checks, plus `phasesForIssue` retry routing), `dashboard/src/lib/reconcile.ts` (display-time warnings), and `dashboard/src/lib/sanityDiff.ts` (±60% window-over-window swing detection, $0-GMV and all-zero-series flags) all exist and are imported by `dashboard/src/app/api/jobs/run/route.ts`.
4. **Provenance stamp**: the report builder in `jobs/run/route.ts` stamps `d30.meta` with `promptVersion`, `weekWindow`, `d30Window`, `priorWindow`, `timezone`, `generatedAt`.
5. **Nothing brand-hardcoded**: grep `dashboard/src` for any hardcoded store UUID, brand name, or API key. The brand name must come only from `NEXT_PUBLIC_BRAND_NAME` via `src/lib/brand.ts`; the store ID only from `EUKA_STORE_ID`. Any literal UUID or brand string in code is a FAIL.
6. **Secrets hygiene**: no `.env*` file is committed; `.gitignore` covers `.env*` and `node_modules`.

## Phase 2 — Build health

From `dashboard/`: run `npm install`, then `npx tsc --noEmit`, then `npm run build` (set placeholder env vars if the build requires them). All three must succeed. Record versions (Node, Next.js) in the report.

## Phase 3 — Configuration

1. Every required env var is set where the app runs (Vercel project settings or `.env.local`): `NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_SECRET` (32+ chars), `DASHBOARD_PASSWORD`, `EUKA_STORE_ID` (a UUID), `EUKA_MCP_URL` (`https://app.euka.ai/api/mcp`), `EUKA_BEARER_TOKEN`, and `ANTHROPIC_API_KEY` if automated reports are wanted. Never print secret values — report set/unset and obvious format problems only.
2. Supabase has the three tables from `supabase-schema.sql`: `weekly_reports`, `app_config`, `report_jobs`.
3. If the app is deployed and you have the URL: the login page loads, and (with the user's help logging in) `/api/admin/check-config` reports `ready: true`.

## Phase 4 — Report correctness (needs at least one generated report)

If no report exists yet, ask the user to generate one (dashboard **+ New Report**, or the manual skill/prompt path) and continue when it's saved. Then fetch the most recent row from `weekly_reports` and verify:

1. **Schema complete**: every field the spec requires exists — `d30` (with `tiers.l1`–`l7`, `gmvMax`, `gmvMaxByAge`), `weekly_charts` (labels + gmv/views/ret/vid + all per-level series crl/ncl/vl/gl/vwl/ml/sl 1–7), `monthly_charts` (adding shopGmv/affiliateGmv and sal1–7), `tables` (topCreators, topVideos, activeCreators, weeklyTopCreators, weeklyTopVideos, weeklyActiveCreators), `agents`, `analysis` (performance, creators, recruiting, growth), `validation`. Missing fields are FAILs, not omissions.
2. **Provenance**: `d30.meta.promptVersion` is `3.0`; `d30.meta.timezone` is `America/Los_Angeles`; the stamped windows are internally consistent (30-day span ending 2 days before the report date; weekWindow is the last complete Sun–Sat week).
3. **Reconciliation gates** (recompute them yourself from the stored JSON — do not trust `validation.passed` blindly):
   - Σ tier gmv (l1..l7) = `d30.gmv` within ±1%; Σ tier views = `d30.views` within ±1%
   - Σ tier creators / newCreators / videos = the d30 totals exactly
   - `gmvMax.spend` = Σ `gmvMaxByAge[].spend` within ±1% (when buckets exist)
   - every weekly series has exactly as many items as `weekly_charts.labels` (13), every monthly series as many as `monthly_charts.labels` (6)
   - per-week Σ gl1..gl7 = that week's `gmv` (±1%); Σ vwl1..vwl7 = that week's `views` (±1%)
   - no negative values anywhere; retention on the percent scale (e.g. 38.1, not 0.381); `d30.gmv` > 0; weekly gmv not all zeros
4. **Sanity vs prior** (when ≥2 reports exist): no 30d headline metric (gmv, orders, videos, views, creators, newCreators, msgs, samples) moved more than ±60% vs the prior report without a `needsReview`/`reconciliation` flag explaining it.
5. **Ground truth spot-check** (with the user): pick 3 numbers — 30d affiliate GMV, 30d videos posted, and one top creator's GMV — and have the user read the same numbers from the Euka dashboard for the same date window. Counts must match exactly; GMV within ±2% (attribution wobble). This is the only check that catches a systematically wrong extraction that is internally consistent.
6. **Determinism** (optional, costs one report run): re-generate the report for the same date. Counts (orders, videos, creators, messages, samples) must match the first run exactly; GMV/views/spend within ±2%; retention within ±0.5 points. Larger drift means the canonical definitions are not pinning the extraction and Phase 1.2 was not really clean.

## Phase 5 — Findings report

Output a single report with: an overall verdict (**PASS** — safe to rely on / **PASS WITH WARNINGS** / **FAIL** — do not trust the numbers); a table of every check with its result; for each FAIL, what is broken, the exact file/field/number, why it matters, and the specific fix; and a short "next steps" list ordered by severity. Offer to apply the code fixes yourself, but only after presenting the report.

Rules throughout: never invent a number you did not read from a file, the database, or the user; never print secrets; if a phase is impossible (no deployment, no Supabase access), mark its checks SKIPPED with what the user must provide to complete them.
