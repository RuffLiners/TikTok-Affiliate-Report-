# TikTok Affiliate Report Kit

A white-label, password-protected analytics dashboard for TikTok Shop affiliate programs. Pulls live data from **Euka**, writes AI analysis with **Claude**, stores everything in **Supabase**, and serves a clean weekly-report web app from **Vercel** (or your own machine).

Works for **any brand** — set your brand name with one environment variable, no code edits needed.

---

## What you get

- **Live 30-Day dashboard** — GMV (total + affiliate), orders, videos, views, creators, new creators, retention, all vs. the prior 30 days
- **Creator levels L1–L7** — full breakdowns of creators, videos, views, GMV, messages, and samples per Euka level
- **GMV Max** — ad spend, revenue, ROI, plus spend broken down by content age
- **Recruiting** — messages sent and samples shipped by level; outreach & CRM agents with full metrics
- **Top tables** — top 15 creators by GMV, top 15 videos, most active creators (30-day and weekly versions)
- **Weekly reports** — saved snapshots with 13-week and 6-month trend charts
- **AI analysis** — four written sections per report: Performance, Creator Highlights, Recruiting Priorities, Growth Opportunities
- **Insights tab** — goal tracker with progress bars (GMV, videos by tier, samples, GMV Max spend/ROI, active creators) showing On Track / At Risk / Off Track

## What's in this folder

| Path | Purpose |
|------|---------|
| `README.md` | This guide |
| `CLAUDE.md` | Instructions that turn Claude into your personal setup assistant — open this folder in Claude Code, or paste `prompts/setup-prompt.md` into claude.ai |
| `dashboard/` | The complete Next.js app — this is what you deploy |
| `supabase-schema.sql` | Run once in Supabase to create the database tables |
| `env.example` | Every environment variable, with instructions |
| `prompts/setup-prompt.md` | Paste into Claude for a guided, beginner-friendly setup |
| `prompts/weekly-report-prompt.md` | Fill-in-the-blanks prompt to generate a report manually |
| `prompts/audit-prompt.md` | Paste into Claude Code to audit that your installation works and the numbers are correct |
| `skills/tiktok-weekly-report/` | Claude skill that pulls all Euka data and outputs the report JSON |
| `skills/tiktok-dashboard-analysis/` | Claude skill for ad-hoc analysis and visualization of your TikTok Shop data |

## What you need

| Requirement | Where | Cost |
|-------------|-------|------|
| Euka account (with your TikTok Shop connected) | app.euka.ai | Your existing plan — **required, no substitute** |
| Supabase account | supabase.com | Free tier is fine — **required** |
| Anthropic API key | console.anthropic.com | ~$5–15/month at 4 reports/month — needed for automated reports |
| GitHub account | github.com | Free — optional (see paths below) |
| Vercel account | vercel.com | Free tier is fine — optional (can run locally instead) |
| Claude Desktop or claude.ai | claude.ai | For manual reports and the included skills |

### Don't have GitHub, Vercel, or Supabase?

All three have free tiers and take minutes to create. And you have options:

- **No GitHub?** Deploy directly from your computer with the Vercel CLI (`npm i -g vercel`, then `vercel --prod` inside `dashboard/`).
- **No Vercel?** Run the app locally: put your env vars in `dashboard/.env.local`, then `npm install && npm run dev` — dashboard at `http://localhost:3000`.
- **No Supabase?** This one you do need — it's the database that stores your reports. The free tier is plenty.

The easiest route for beginners: **let Claude walk you through it.** Open this folder in Claude Code (Claude reads `CLAUDE.md` automatically), or paste `prompts/setup-prompt.md` into claude.ai, and Claude will guide you click-by-click through creating every account.

---

## Quick start (Path A: GitHub + Vercel, recommended)

Takes about 45–60 minutes the first time.

1. **Put the code on GitHub** — create a new private repository and upload the contents of this folder (the `dashboard/` folder must be at the top level of the repo).
2. **Create a Supabase project** — then open SQL Editor, paste all of `supabase-schema.sql`, click Run. Copy the Project URL, anon key, and service_role key from Settings → API.
3. **Get Euka credentials** — Store ID (a UUID in Settings), bearer token (Settings → API). MCP URL is always `https://app.euka.ai/api/mcp`.
4. **Get an Anthropic API key** — console.anthropic.com → API Keys → Create Key (add a payment method first).
5. **Create a Vercel project** — sign up with GitHub, import your repo, and set the **Root Directory to `dashboard`** before deploying.
6. **Add environment variables** in Vercel → Settings → Environment Variables (full list below), then **Deploy**.
7. **Log in** at your `*.vercel.app` URL with your `DASHBOARD_PASSWORD`.
8. **Generate your first report** — click **+ New Report** (automated, ~15–25 min) or use the manual path below.

## Environment variables

Copy from `env.example`. Set these in Vercel (Settings → Environment Variables) or in `dashboard/.env.local` for local runs.

| Variable | What it is |
|----------|-----------|
| `NEXT_PUBLIC_BRAND_NAME` | **Your brand name** — appears in the header, login page, browser tab, and report prompts |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role key (keep secret) |
| `AUTH_SECRET` | Make up a long random string (32+ chars) — signs login tokens |
| `DASHBOARD_PASSWORD` | The password you'll use to log in |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys (`sk-ant-...`) |
| `EUKA_STORE_ID` | Your Euka store UUID |
| `EUKA_MCP_URL` | Always `https://app.euka.ai/api/mcp` |
| `EUKA_BEARER_TOKEN` | Your Euka API token, with the `Bearer ` prefix |
| `EXTRACTION_MODEL` | Optional — Claude model for data-pull phases (has a sensible default) |
| `ANALYSIS_MODEL` | Optional — Claude model for analysis writing (defaults to the extraction model) |

## Generating reports

**Automated (recommended):** On the dashboard, click **+ New Report**. The app runs a multi-phase background job — Claude pulls each slice of data from Euka via MCP, writes the analysis, validates the numbers reconcile, and saves the report. The Live page's **Refresh live data** button is a faster 30-day snapshot without charts/analysis.

**Manual (no Anthropic API key needed):**
1. Connect Euka's MCP to Claude Desktop or claude.ai (connector URL `https://app.euka.ai/api/mcp` + your bearer token).
2. Install the `skills/tiktok-weekly-report` skill (or paste `prompts/weekly-report-prompt.md` with the brackets filled in).
3. Claude runs all 23 queries and outputs one JSON object (5–20 minutes).
4. Copy the whole JSON → dashboard → **Manual Entry** → paste → save.

## Using the included skills

The `skills/` folder contains two Claude skills you can install (Claude Desktop → Settings → Skills, or your org's skill library):

- **tiktok-weekly-report** — the full canonical report run: every query, every guardrail, exact JSON output for the dashboard. Use it weekly.
- **tiktok-dashboard-analysis** — interactive, ad-hoc exploration: "how did L5 creators do this month?", "show me the GMV trend", "which inactive creators should we reactivate?" Builds charts and answers questions directly in Claude using your Euka connection.

Both skills read your brand name and store ID from you at run time — nothing brand-specific is baked in.

## Customizing for your brand

- **Name**: set `NEXT_PUBLIC_BRAND_NAME`. Done.
- **Goals**: dashboard → Manage → Goals & Targets (powers the Insights tab progress bars).
- **Colors/logo**: the UI is plain Tailwind — edit `dashboard/src/app/globals.css` and the header components if you want a logo or palette change.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Login page won't load / build fails | Check all required env vars; on Vercel confirm Root Directory is `dashboard`; redeploy |
| "Supabase URL required" | `NEXT_PUBLIC_SUPABASE_URL` or anon key missing/wrong |
| Automated report fails or stalls | Check `ANTHROPIC_API_KEY` and Euka token; look at the `report_jobs` table's `error` column in Supabase |
| Claude Desktop can't see Euka tools | Re-check the MCP connector config and token, restart Claude Desktop |
| Charts empty on old reports | Older reports may lack per-tier views data — placeholder is expected |
| Numbers seem off | Reports have reconciliation guardrails (tier sums must equal totals). Re-run the report; don't hand-edit the JSON |

Still stuck? Paste `prompts/setup-prompt.md` into Claude and describe what you're seeing — it will troubleshoot with you.

Want a full health check? Open the kit folder in Claude Code and paste `prompts/audit-prompt.md` — Claude will audit the code, configuration, and your latest report's numbers end-to-end and give you a pass/fail report with fixes.

## Estimated monthly cost

| Service | Tier | Cost |
|---------|------|------|
| Vercel | Hobby | $0 |
| Supabase | Free | $0 |
| GitHub | Free | $0 |
| Anthropic API | Pay-per-use | ~$5–15 (4 reports/month) |
| Euka | Your existing plan | already paying |

## Architecture

```
You (browser)
    ↓
Vercel — hosts the Next.js app (dashboard/)
    ↓
Supabase — stores reports, goals, job queue
    ↑
Anthropic API — Claude pulls data + writes analysis (automated path)
    ↕
Euka MCP (https://app.euka.ai/api/mcp)
    ↓
TikTok Shop — your store's data
```

One deployment = one store. To run multiple brands, deploy the kit once per brand with different env vars — same code, zero changes.
