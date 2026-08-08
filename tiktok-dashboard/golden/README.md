# Golden-week regression test

Proves that a prompt, model, or schema change didn't break report accuracy
(reliability audit, Finding 4). One frozen historical week is the reference;
any re-run of that week must reproduce its numbers within tolerance.

## One-time setup (capture the golden week)

1. Pick a stable, fully-attributed historical week — e.g. the report for
   week ending 2026-07-11 (attribution has settled after ~2 weeks).
2. Manually verify its key numbers against the Euka UI once: 30d GMV, orders,
   creators, retention, tier GMV split, GMV Max spend, weekly GMV series.
3. Export that report row from Supabase (`weekly_reports` where
   `report_date = '...'` → copy the row as JSON) and save it as
   `golden/golden.json`. Commit it.

`golden.json` is deliberately not in the repo yet — it must be hand-verified
against Euka before it can serve as truth. Don't generate it mechanically.

## Running the test

After ANY change to `prompts/master-prompt-v3.md`, the phase prompts in
`src/app/api/jobs/run/route.ts`, `EXTRACTION_MODEL`/`ANALYSIS_MODEL`, or the
Euka schema:

1. Re-run the report for the golden date (Admin → Auto-Generate with
   `today` pinned to the golden report's date, so the windows match exactly).
2. Diff it:

```
npx tsx scripts/golden-diff.ts golden/golden.json --db <golden-report-date>
```

Tolerances: counts (orders, videos, creators, messages, samples) must match
exactly; GMV/views/spend within ±2% (attribution wobble); retention ±0.5 pts.
Exit code 1 means the change broke accuracy — don't ship it.
