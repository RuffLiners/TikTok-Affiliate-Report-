# Regenerated 2026-08-24 weekly report (spec v3.1)

This folder is the corrected replacement for the 2026-08-24 report that
shipped with data-integrity bugs, plus the evidence for the fixes.

| File | What it is |
|---|---|
| `manual-report-2026-08-24.json` | The skill-format report — **paste this at `/admin` → Manual Entry to replace the bad saved report**. Every number re-pulled from Euka for the exact windows: 30d = 2026-07-24…2026-08-22, week = 2026-08-16…2026-08-22 (America/Los_Angeles). |
| `auto-row-2026-08-24.json` | The same phase data run through the production auto-generate assembly (`src/lib/assembleReport.ts`) — the `weekly_reports` row the auto path would save. |
| `phase-data-2026-08-24.json` | Raw per-phase extraction results (provenance for both files above). |
| `parity-and-gates.txt` | Output of `scripts/parity-diff.ts` and `scripts/assemble-row.ts`: **auto and manual rows are identical** except `d30.meta.generatedAt/source/savedAt`, hard gate V1–V13 all pass, `reconcileD30` clean. |

## What was wrong, and what's fixed here

1. **topCreators was 15 blank rows** — extraction data existed the whole
   time; the failure was swallowed (nothing validated tables, the JSON-coerce
   follow-up invited zero-filled placeholder rows, and `sanitizeRows` masked
   null handles as `""`). This report has all 15 rows populated with real
   handles, and V13 now hard-rejects any report with an empty required table
   or a blank-handle row on both the auto and manual paths.
2. **Analysis called the 30d GMV "the week of August 16–22"** — the corrected
   analysis states the window for every figure: 30d GMV $347,891
   (Jul 24–Aug 22), this week's GMV $82,195 (Aug 16–22, the last element of
   `weeklyCharts.gmv`).
3. **Tier GMV vs affiliateGmv gap ($347,891 vs $314,842)** — legitimate by
   design: tiers decompose `d30.gmv` (SUM of `creator_store_performance.gmv`,
   video + livestream + showcase); `d30.affiliateGmv` is Euka's dashboard
   `totalAffiliateGMV`, a differently-attributed metric. Tier sum here is
   $347,891.92 — within the new $1 check (V14). A standing reconciliation
   note now documents the relationship on every report.
4. **dealsfordayzz ggmv = 150000** — verified genuine: Euka's `creators`
   table stores `gmv_30d_num = 150000` for uid 7494820209026763461. Not
   fabricated. The value still trips the new V15 round-number spot-check by
   design (see below).

## After saving this report

- The save will flag `NEEDS REVIEW` for two expected reasons:
  `swing:views` (30d views +182% vs the prior report's old, wrong views
  source — the new 14,821,899 is verified correct) and
  `round:tables.topVideos.ggmv:dealsfordayzz:150000` (verified genuine).
  Mark both reviewed so they stop re-firing:

  ```
  POST /api/admin/review-flags
  {"add":["swing:views","round:tables.topVideos.ggmv:dealsfordayzz:150000"]}
  ```

- Next week's sanity diff automatically baselines against THIS report's
  corrected values (it always compares to the most recent saved report).
