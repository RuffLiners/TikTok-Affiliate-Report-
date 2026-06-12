# TikTok Affiliate Dashboard — Setup Kit

A private, branded analytics dashboard for TikTok Shop affiliate programs. Pulls live data from Euka, runs AI analysis with Claude, and presents weekly reports in a clean web interface.

---

## What You'll Need Before Starting

| Requirement | Where to get it | Cost |
|-------------|----------------|------|
| Euka account | app.euka.ai | Paid (your existing subscription) |
| GitHub account | github.com | Free |
| Supabase account | supabase.com | Free tier works fine |
| Vercel account | vercel.com | Free tier works fine |
| Anthropic API key | console.anthropic.com | ~$2–10/month depending on report frequency |
| Claude Desktop | claude.ai/download | Free (Pro plan recommended for Euka MCP) |

---

## Files in This Folder

| File | Purpose |
|------|---------|
| `README.md` | This document — start here |
| `SKILLS.md` | Full description of what the dashboard does and how it works |
| `supabase-schema.sql` | Run this in Supabase to create the database tables |
| `env.example` | Template for all required environment variables |
| `setup-prompt.md` | Paste this into Claude to get step-by-step setup help |
| `weekly-report-prompt.md` | Paste this into Claude Desktop each week to generate a report |

---

## Quick Start (Overview)

The full process takes about 45–60 minutes the first time:

1. **Fork the repo** to your GitHub account
2. **Create a Supabase project** and run the schema SQL
3. **Create a Vercel project** connected to your GitHub fork
4. **Add environment variables** to Vercel (Supabase keys, Euka credentials, passwords)
5. **Deploy** — your dashboard is live at a `*.vercel.app` URL
6. **Connect Euka to Claude Desktop** (one-time MCP setup)
7. **Run your first report** using the weekly report prompt

---

## Detailed Setup Guide

### Step 1 — Fork the Repository

1. Go to the GitHub repository URL provided to you by whoever shared this kit
2. Click **Fork** (top right) → **Create fork**
3. You now have your own copy at `github.com/YOUR-USERNAME/repository-name`

### Step 2 — Set Up Supabase

Supabase is your database — it stores all your reports, settings, and configuration.

1. Go to [supabase.com](https://supabase.com) → **Start your project** → Sign up free
2. Click **New Project**
   - Choose an organization (create one if prompted)
   - Give it a name (e.g. "tiktok-dashboard")
   - Choose the region closest to you
   - Set a strong database password — **save this somewhere**
3. Wait ~2 minutes for the project to provision
4. Go to **SQL Editor** (left sidebar)
5. Open `setup-kit/supabase-schema.sql` from this repo, copy the entire contents
6. Paste into the SQL Editor and click **Run**
7. You should see: "Success. No rows returned" — this means the tables were created
8. Go to **Settings → API** (left sidebar) and copy:
   - **Project URL** (looks like `https://abcdefghij.supabase.co`)
   - **anon/public** key (long string starting with `eyJ`)
   - **service_role** key (another long string starting with `eyJ`) — keep this secret

### Step 3 — Set Up Vercel

Vercel hosts the web app so you can access your dashboard from any browser.

1. Go to [vercel.com](https://vercel.com) → **Sign up with GitHub** (this links the accounts)
2. Click **Add New → Project**
3. Find your forked repository and click **Import**
4. **IMPORTANT**: Before deploying, set the **Root Directory** to `tiktok-dashboard`
   - Click the root directory field and type `tiktok-dashboard`
   - This tells Vercel the app lives in the subfolder, not the repo root
5. **Do not click Deploy yet** — skip to Step 4 to add environment variables first

### Step 4 — Get Your Euka Credentials

1. Log into [app.euka.ai](https://app.euka.ai)
2. Find your **Store ID**:
   - Go to Settings or your store profile
   - Look for a UUID (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
3. Find your **API / Bearer Token**:
   - Go to Settings → API or Developer settings
   - Copy the bearer token (it may start with `Bearer ` — include that prefix)
4. Your **MCP URL** is always: `https://app.euka.ai/api/mcp`

### Step 5 — Get Your Anthropic API Key

The dashboard uses Claude in the background to run analysis. You need an API key for this.

1. Go to [console.anthropic.com](https://console.anthropic.com) → Sign up
2. Add a payment method (Settings → Billing) — you're charged per use, typically $2–5 per full report
3. Go to **API Keys → Create Key**
4. Copy the key — it starts with `sk-ant-` and you can only see it once

### Step 6 — Add Environment Variables to Vercel

Back in Vercel, before deploying:

1. Go to your project → **Settings → Environment Variables**
2. Add each of the following (Name = value):

| Variable Name | Value | Where to find it |
|--------------|-------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key | Supabase → Settings → API |
| `AUTH_SECRET` | Any long random string (32+ chars) | Make it up — like a strong password |
| `DASHBOARD_PASSWORD` | Your chosen login password | Make it up — this is how you log in |
| `ANTHROPIC_API_KEY` | Your Anthropic API key | console.anthropic.com → API Keys |
| `EUKA_STORE_ID` | Your store UUID | Euka → Settings |
| `EUKA_MCP_URL` | `https://app.euka.ai/api/mcp` | Always this value |
| `EUKA_BEARER_TOKEN` | Your Euka bearer token | Euka → Settings → API |

3. After adding all 9 variables, click **Deploy**
4. Wait 1–3 minutes for the build to complete

### Step 7 — Verify the Deployment

1. Click the deployment URL (e.g. `your-project.vercel.app`)
2. You should see a login page
3. Enter the `DASHBOARD_PASSWORD` you set
4. You should see the dashboard — empty for now, but working!

If you get an error, check:
- All 9 environment variables are set in Vercel
- The Root Directory is set to `tiktok-dashboard`
- Redeploy: Deployments → ⋯ → Redeploy

### Step 8 — Connect Euka to Claude Desktop (One-Time Setup)

This lets Claude pull your TikTok data when you run the weekly report prompt.

1. Download [Claude Desktop](https://claude.ai/download) if you don't have it
2. Open Claude Desktop → **Settings** (gear icon) → **Developer** → **Edit Config**
3. Add the Euka MCP server to the config file. It will look like this:

```json
{
  "mcpServers": {
    "euka": {
      "command": "npx",
      "args": ["-y", "@euka/mcp-server"],
      "env": {
        "EUKA_MCP_URL": "https://app.euka.ai/api/mcp",
        "EUKA_BEARER_TOKEN": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

Replace `YOUR_TOKEN_HERE` with your actual Euka bearer token (without the word "Bearer" if you're including it in the string — check Euka's docs for the exact format).

4. Save the file and **restart Claude Desktop**
5. Open a new conversation and ask: `What tools do you have available?`
6. You should see Euka tools listed (like `query_store_data`, `list_outreach_agents`, etc.)

> **Note:** If you already have other MCP servers configured, add the `"euka"` block inside the existing `"mcpServers"` object — don't replace the whole file.

---

## Running Your Weekly Report

### Every week, do this:

1. Open Claude Desktop (with Euka MCP connected)
2. Open `setup-kit/weekly-report-prompt.md` from this repo
3. Fill in the `[BRACKETED FIELDS]`:
   - Your brand name
   - Today's date
   - Your Euka Store ID
   - The date windows (see the prompt file for how to calculate these)
4. Paste the entire filled-in prompt into Claude Desktop
5. Wait 5–20 minutes — Claude is pulling data from Euka and running analysis
6. When it finishes, you'll see a large JSON object starting with `{`
7. **Copy the entire JSON**
8. Go to your dashboard → click **Manual Entry** (on the Live page)
9. Paste the JSON and save
10. Your new report will appear in **Weekly Reports Page**

### Or use the insert script (for developers):

```bash
cd tiktok-dashboard
# Edit scripts/insert-report.ts and paste the JSON as REPORT_DATA
npx ts-node scripts/insert-report.ts
```

---

## Using the Dashboard

### Live 30 Day Page
- Click **Refresh live data** to pull a quick snapshot of the current 30 days
- This runs faster than a full report (~5–10 min) and updates the live view only
- Use **Manual Entry** to paste a full JSON report

### Weekly Reports Page
- Lists all saved reports, newest first
- Click any report to open the full detail view
- Each report has 4 tabs: Last 30 Days, Weekly (13 wks), Monthly (6 mo), Insights

### Manage Page (Admin only)
- **Reports**: Edit analysis text, replace report data, delete reports
- **Goals & Targets**: Set monthly/quarterly targets — these power the progress bars in the Insights tab

---

## Customizing for Your Brand

The app name appears in a few places in the code. To white-label it for your brand:

1. Search for the placeholder brand name in the `tiktok-dashboard/src/` folder
2. Replace every instance with your brand name
3. The main locations are:
   - `src/app/dashboard/page.tsx` — header title
   - `src/app/dashboard/[reportDate]/page.tsx` — report header
   - `src/app/layout.tsx` — browser tab title (if set)

---

## Troubleshooting

### Dashboard won't load / login fails
- Check all 9 environment variables are set in Vercel
- Redeploy from Vercel dashboard
- Check Vercel build logs for errors

### "Supabase URL required" error
- Your `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` is missing or wrong
- Double-check in Vercel → Settings → Environment Variables

### Report generation fails / Claude times out
- Claude Desktop needs to be open with Euka MCP connected
- Check that your Euka bearer token is valid and not expired
- Large reports can take 15–20 minutes — be patient

### Empty charts / missing data
- Some older reports won't have views-by-tier data — this is normal and shows a placeholder
- Make sure your weekly report prompt includes all 23 queries

### Can't find my Euka Store ID
- Log into app.euka.ai
- Go to Settings or your profile
- Look for a UUID (8-4-4-4-12 character format with dashes)
- Contact Euka support if you can't find it

---

## Getting Help

1. **Re-read this README** — most issues are covered above
2. **Use the setup prompt** — paste `setup-prompt.md` into Claude and describe what's happening
3. **Check Vercel build logs** — Deployments → click the failed deployment → View Build Logs
4. **Check Supabase logs** — Supabase → Logs → API for database errors

---

## Cost Estimates

| Service | Tier | Estimated Monthly Cost |
|---------|------|----------------------|
| Vercel | Hobby (free) | $0 |
| Supabase | Free tier | $0 (up to 500MB) |
| GitHub | Free | $0 |
| Anthropic API | Pay-per-use | $5–15/month (4 reports/month) |
| Euka | Your existing plan | Already paying |
| **Total new cost** | | **~$5–15/month** |

---

## Architecture Overview

```
You (browser)
    ↓
Vercel (hosts the Next.js app)
    ↓
Supabase (stores reports, config, jobs)
    ↑
Claude Desktop (you run this locally)
    ↓
Euka MCP Server (pulls TikTok data)
    ↓
TikTok Shop (your store data)
```

The app itself is a Next.js 16 application. Reports can be generated two ways:
- **Automated**: The "+ New Report" button triggers a 20-phase async job that runs Claude with Euka MCP server-side through Vercel
- **Manual**: You run the weekly prompt in Claude Desktop and paste the resulting JSON into the dashboard
