# TikTok Affiliate Dashboard (app)

The Next.js app for the TikTok Affiliate Report Kit. Full setup instructions live one level up in the kit's [`README.md`](../README.md); a Claude-guided walkthrough is in [`CLAUDE.md`](../CLAUDE.md).

## Local development

```bash
cp ../env.example .env.local   # then fill in real values
npm install
npm run dev                    # http://localhost:3000
```

Checks:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## Deploying to Vercel

Import the repository and set the project's **Root Directory** to `dashboard`, then add every variable from `../env.example` under Settings → Environment Variables.

## Key places in the code

| Path | What it does |
|------|--------------|
| `src/lib/brand.ts` | Brand name from `NEXT_PUBLIC_BRAND_NAME` — never hardcode a brand |
| `src/lib/canonicalDefs.ts` | Pinned metric definitions used by every report prompt — keep in sync with `../skills/tiktok-weekly-report/SKILL.md` |
| `src/lib/validateReport.ts` | Validates the report JSON shape before saving |
| `src/app/api/jobs/*` | Async multi-phase automated report generation (Claude + Euka MCP) |
| `src/app/api/live-manual/route.ts` | Fast live 30-day refresh job |
| `src/app/dashboard/*` | Report list + detail pages |
| `src/app/admin/*` | Manage page: report generation, editing, goals |
| `scripts/insert-report.ts` | Insert a report JSON from the command line |
