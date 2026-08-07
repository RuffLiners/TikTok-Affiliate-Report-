# Setup Prompt for Claude

Copy everything below the line and paste it into Claude (claude.ai or Claude Desktop). Claude will walk you through the entire setup step by step. If you're using Claude Code with this kit folder open, you don't need this file — just say "help me set this up" and Claude will follow the instructions in CLAUDE.md.

---

I need your help setting up a TikTok Shop affiliate analytics dashboard from a "TikTok Affiliate Report Kit" folder I downloaded. I am a complete beginner. Please walk me through every step slowly and clearly, one step at a time, and wait for me to confirm each step is done before moving to the next one.

Here is what I have:
- An Euka account (app.euka.ai) with my TikTok Shop connected
- The kit folder, which contains: a `dashboard/` folder (the Next.js app), `supabase-schema.sql`, `env.example`, a `prompts/` folder, and a `skills/` folder
- Access to Claude (that's where I'm talking to you right now)
- I may NOT have GitHub, Vercel, Supabase, or Anthropic accounts yet — ask me which ones I have before we start

Here is what we are building: A private, password-protected analytics dashboard for MY BRAND that pulls my TikTok affiliate data from Euka, runs AI analysis with Claude, and shows me weekly reports — GMV, creators by level, videos, GMV Max ads, recruiting, and more. The brand name is set with an environment variable called NEXT_PUBLIC_BRAND_NAME, so no code editing is needed.

First, ask me:
1. Which accounts I already have (GitHub / Vercel / Supabase / Anthropic)
2. My brand name
3. Whether I want the dashboard hosted online (recommended — GitHub + Vercel) or running only on my own computer

Then guide me through these steps in order, adapting to my answers. Explain what each service is and why I need it before asking me to sign up.

STEP 1 — Get the code somewhere deployable
- If I'm using GitHub + Vercel: help me create a free GitHub account, create a new PRIVATE repository, and upload the contents of the kit folder (the `dashboard/` folder must end up at the top level of the repo). Walk me through GitHub's "uploading an existing file" flow.
- If I don't want GitHub: help me install Node.js (nodejs.org, LTS version) and open a terminal in the kit folder instead.

STEP 2 — Set up the database (Supabase — required no matter what)
- Explain what Supabase is (free database that stores my reports and settings)
- Help me create a free account and a New Project (closest region, strong database password — remind me to save it)
- Walk me through the SQL Editor: paste the entire contents of supabase-schema.sql and click Run
- Confirm 3 tables were created: weekly_reports, app_config, report_jobs
- Then Settings → API: save the Project URL, anon public key, and service_role key

STEP 3 — Get my Euka credentials
- Store ID (a UUID in Settings/profile), Bearer Token (Settings → API), and the MCP URL which is always https://app.euka.ai/api/mcp

STEP 4 — Get my Anthropic API key (skip if I only want manual reports)
- Explain this powers the automated "+ New Report" button and AI analysis
- console.anthropic.com → add payment method → API Keys → Create Key (starts with sk-ant-)
- Warn me it's pay-per-use, typically a few dollars per report

STEP 5 — Environment variables
Walk me through each variable from env.example, explaining what it is:
- NEXT_PUBLIC_BRAND_NAME — my brand name (appears on the dashboard)
- NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY — from Step 2
- AUTH_SECRET — a made-up random string, 32+ characters
- DASHBOARD_PASSWORD — the password I'll log in with
- ANTHROPIC_API_KEY — from Step 4
- EUKA_STORE_ID, EUKA_MCP_URL, EUKA_BEARER_TOKEN — from Step 3 (include the "Bearer " prefix on the token)

STEP 6 — Deploy
- GitHub + Vercel path: vercel.com → sign up with GitHub → Add New Project → import my repo → set Root Directory to "dashboard" (IMPORTANT — the app is in a subfolder) → add all the environment variables → Deploy
- Vercel without GitHub: `npm i -g vercel`, `vercel login`, add env vars, then `vercel --prod` from inside the dashboard folder
- Local-only path: create dashboard/.env.local with all the variables, then `npm install && npm run dev` inside the dashboard folder, and open http://localhost:3000

STEP 7 — Verify
- I should see a login page; my DASHBOARD_PASSWORD gets me into an empty dashboard
- If not, help me troubleshoot (env vars, Root Directory, build logs) before moving on

STEP 8 — First report
- If I have an Anthropic key: show me the "+ New Report" button (takes ~15–25 minutes) and the "Refresh live data" button for quick snapshots
- Manual alternative: connect Euka's MCP to Claude (connector URL https://app.euka.ai/api/mcp with my bearer token), run the prompts/weekly-report-prompt.md with the brackets filled in, copy the JSON output, and paste it into the dashboard's Manual Entry panel

STEP 9 — Goals (optional)
- Manage page → Goals & Targets; suggest starting with a monthly GMV target

After completing all steps, summarize: my dashboard URL, my weekly report routine, and where to get help.

Throughout this entire process:
- Use plain English, no jargon
- If I get confused or stuck, ask me to describe what I see on my screen
- Never assume I know how to do something — explain every click
- If something fails, help me troubleshoot before moving on
