# Brand-Kit Parity Audit (maintainer only — do NOT ship this file to brand owners)

Paste everything below the line into **Claude Code opened in this repository** (the one containing both `tiktok-dashboard/` and `brand-kit/`). It audits that the white-label kit in `brand-kit/` works and reports **exactly the same numbers, the same way**, as the production Ruff Liners tool in `tiktok-dashboard/` — the reference implementation built and hardened over this repo's history (canonical metric definitions, master spec v3, strict validation gates, sanity diff, golden-week test). Run it before every handoff of the kit to a brand owner, and after any change to either app.

This file stays in this repo only. Brand owners get the `brand-kit/` folder, which has its own self-contained audit at `brand-kit/prompts/audit-prompt.md` and no access to anything Ruff Liners.

---

You are auditing `brand-kit/dashboard` (the white-label kit) against `tiktok-dashboard` (the production reference) in this repository. The kit must be functionally identical to production — same pipeline, same metric definitions, same validation, same output schema — with **only** the whitelisted generic-ization deltas below. Anything outside the whitelist is drift and a finding. Audit first, fix only after presenting findings.

## Allowed deltas (the whitelist — everything else must be identical)

1. **Branding**: production hardcodes "Ruff Liners"; the kit uses `BRAND_NAME` from `src/lib/brand.ts` (env `NEXT_PUBLIC_BRAND_NAME`). `lib/brand.ts` exists only in the kit.
2. **Store ID**: production may hardcode the store UUID in client code; the kit must get it only from `EUKA_STORE_ID` (server routes) or the authenticated `/api/admin/check-config` response (admin client page). A literal store UUID anywhere in the kit is a critical finding.
3. **Auth cookie name**: production `rl-auth`, kit `dash-auth` — consistently, in every route and middleware/proxy.
4. **Brand-specific prompt examples**: production's product-name-shortening examples name real Ruff Liners products; the kit states the generic shortening rule with a neutral example.
5. **Brand-specific dates**: production pins its GMV Max start date ("May 14 2026"); the kit says "use 0 if GMV Max data is unavailable for the window". Same zero-fill semantics, no date.
6. **Extra kit files**: `src/app/api/generate-report/route.ts` (single-call manual generation) and `src/lib/brand.ts`. Production-only files: `prompts/master-prompt-v3.md`, `prompts/SKILL-ruff-liners-euka-json-report.md`, `golden/`, `scripts/golden-diff.ts`, and anything else Ruff-specific — confirm none of these (or their contents) leaked into the kit.
7. **Comment wording** referring to "the tiktok-weekly-report skill" instead of "the org's ruff-liners-euka-json-report skill".

## Phase 1 — Static parity

1. **File-tree diff**: `diff <(cd tiktok-dashboard/src && find . -type f | sort) <(cd brand-kit/dashboard/src && find . -type f | sort)` — every difference must be on the whitelist (item 6).
2. **Line-level diff of the load-bearing files** — for each, produce the diff, classify every hunk as whitelisted or drift:
   - `src/lib/canonicalDefs.ts` (must both export `PROMPT_VERSION` with the SAME value and semantically identical metric definitions)
   - `src/lib/validateReport.ts`, `src/lib/reconcile.ts`, `src/lib/sanityDiff.ts` (expected: byte-identical)
   - `src/app/api/jobs/run/route.ts` (the 20-phase pipeline: same phases, same prompts modulo whitelist items 1/4/5, same validation-retry via `phasesForIssue`, same `d30.meta` provenance stamp, same sanity-diff/needsReview/live-snapshot-hold logic, same job status labels)
   - `src/app/api/live-manual/route.ts`, `src/app/api/agents/route.ts`, `src/app/api/save-report/route.ts`, `src/app/api/report/route.ts`, `src/app/api/jobs/*`
   - `src/lib/auth.ts`, `src/proxy.ts` and every `src/app/api/auth/*` and `src/app/api/admin/*` route (cookie-name delta only)
   - all dashboard pages/components under `src/app/dashboard`, `src/components` (branding delta only)
3. **Spec-copy sync**: the kit's `skills/tiktok-weekly-report/SKILL.md` and `prompts/weekly-report-prompt.md` must carry the same canonical definitions, the same 23 queries, the same 12 self-validation gates (V1–V12), and the same output JSON schema as production's `prompts/master-prompt-v3.md` — with only whitelisted deltas. Field-by-field: every key in the production report schema exists in the kit's schema and vice versa.
4. **Leak sweep**: grep the whole `brand-kit/` (excluding node_modules) for: "Ruff", "ruffliners", the production store UUID, real product names, any `sk-ant-`/`eyJ` value that isn't an obvious placeholder, personal emails, and `*.vercel.app` deployment URLs. Any hit is a critical finding.
5. **Kit docs**: `brand-kit/README.md`, `CLAUDE.md`, `env.example`, `supabase-schema.sql`, `prompts/setup-prompt.md`, `prompts/audit-prompt.md` reference only things inside the kit; the schema SQL matches the tables production uses.

## Phase 2 — Build parity

From `brand-kit/dashboard`: `npm install`, `npx tsc --noEmit`, `npm run build` all pass, same as production. Flag any dependency-version differences in `package.json` between the two apps.

## Phase 3 — Behavioral parity (numbers)

Goal: prove the kit's pipeline reproduces the production tool's numbers for the same store and window. Ask me (the maintainer) before spending API credits; each full run costs a few dollars.

1. **Reference report**: use the latest production report for a settled week (or `tiktok-dashboard/golden/golden.json` once captured) — export the row from the production Supabase `weekly_reports` table.
2. **Kit run against the same data**: run the kit (locally is fine: `.env.local` pointing at a **scratch** Supabase project — never production's — with the same `EUKA_STORE_ID` and windows pinned to the reference report's `d30.meta` windows) and generate the report for the same date.
3. **Diff the two reports** with the golden tolerances: counts (orders, videos, creators, new creators, messages, samples — headline and every tier/weekly/monthly bucket) match **exactly**; GMV, views, spend within **±2%**; retention within **±0.5 points**; identical series lengths and labels; identical schema keys. `scripts/golden-diff.ts` in production shows the comparison pattern — adapt it rather than eyeballing.
4. **Validation parity**: both reports pass the same strict gate (`validateGeneratedReport` returns no issues) and neither carries unexplained `needsReview` flags.
5. If any number lands outside tolerance, trace it: diff the exact phase prompt that produced it between the two apps (it will be a Phase-1 miss), or confirm it is attribution drift by re-running that phase once.

## Phase 4 — Verdict

Output: **SHIP** (kit is at parity, safe to hand to a brand owner) / **HOLD** (findings must be fixed first), followed by a table of every finding — file, whitelisted-or-drift classification, severity (critical = wrong numbers or a Ruff Liners leak; major = behavior differs; minor = cosmetic), and the exact fix. Offer to apply fixes and re-run the failed phase.

Rules: never point the kit at the production Supabase; never commit env files; never print secrets; classify before fixing.
