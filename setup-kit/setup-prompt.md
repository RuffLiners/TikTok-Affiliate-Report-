# Setup Prompt for Claude

Copy everything below this line and paste it into Claude (claude.ai). Claude will walk you through the entire setup step by step.

---

I need your help setting up a TikTok Shop affiliate analytics dashboard from scratch. I am a complete beginner with GitHub, Vercel, and Supabase. Please walk me through every step slowly and clearly, one step at a time. Wait for me to confirm each step is done before moving to the next one.

Here is what I have:
- An Euka account (euka.ai) with my TikTok Shop connected
- Access to claude.ai (that's where I'm talking to you right now)
- A computer with a web browser
- I do NOT yet have GitHub, Vercel, Supabase, or Anthropic accounts

Here is what we are building: A private analytics dashboard that pulls my TikTok affiliate data from Euka, runs AI analysis with Claude, and shows me weekly reports — GMV, creators, videos, GMV Max ads, recruiting, and more.

Please guide me through these steps in order. Explain what each service is and why I need it before asking me to sign up. Go one step at a time and check in with me after each one.

STEP 1 — Get the code (GitHub)
- Explain what GitHub is (1–2 sentences)
- Ask me to create a free account at github.com if I don't have one
- Tell me to go to the GitHub repository that was shared with me (the person sharing this kit should provide the URL)
- Explain what "forking" means and ask me to fork the repo to my own GitHub account
- Confirm I can see the code in my own GitHub account before continuing

STEP 2 — Set up the database (Supabase)
- Explain what Supabase is and why we need it (stores all my reports and settings)
- Ask me to create a free account at supabase.com
- Walk me through creating a new project (region closest to me, strong database password — tell me to save it)
- Once the project is created, tell me to go to the SQL Editor
- Tell me to open the file setup-kit/supabase-schema.sql from the GitHub repo and copy the entire contents
- Tell me to paste it into the SQL Editor and click Run
- Tell me what to look for to confirm it worked (3 tables created: weekly_reports, app_config, report_jobs)
- Tell me to go to Settings → API and copy three things: Project URL, anon/public key, service_role key — and save them somewhere safe

STEP 3 — Deploy the app (Vercel)
- Explain what Vercel is (hosts the app so I can access it from any browser)
- Ask me to create a free account at vercel.com — tell me to sign up with my GitHub account (this connects them automatically)
- Once logged in, tell me to click "Add New Project"
- Tell me to import the forked GitHub repo
- IMPORTANT: Tell me to set the Root Directory to "tiktok-dashboard" before deploying (the app is inside this subfolder)
- Tell me NOT to deploy yet — we need to add environment variables first

STEP 4 — Get my Euka credentials
- Explain that Euka is where my TikTok data lives and we need credentials to connect to it
- Tell me to log into my Euka account at app.euka.ai
- Walk me through finding my Store ID (Settings or Account page — it's a UUID like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
- Tell me the MCP URL is always: https://app.euka.ai/api/mcp
- Walk me through finding or generating my Bearer Token / API key in Euka settings
- Tell me to save: Store ID, MCP URL, Bearer Token

STEP 5 — Get my Anthropic API key
- Explain that Claude needs an API key to run the AI analysis in the background (separate from claude.ai)
- Tell me to go to console.anthropic.com and create an account
- Walk me through creating an API key (API Keys section → Create Key)
- Tell me to copy and save it (it starts with sk-ant-)
- Warn me that I'll be charged per use (very cheap — typically a few dollars per report) and to add a payment method

STEP 6 — Add environment variables to Vercel
- Tell me to go back to the Vercel project I started in Step 3
- Go to Settings → Environment Variables
- Walk me through adding each variable one by one, explaining what each one is:
  - NEXT_PUBLIC_SUPABASE_URL — my Supabase Project URL from Step 2
  - NEXT_PUBLIC_SUPABASE_ANON_KEY — my Supabase anon key from Step 2
  - SUPABASE_SERVICE_ROLE_KEY — my Supabase service role key from Step 2
  - AUTH_SECRET — tell me to make up a long random string (at least 32 characters), like a strong password. This signs my login tokens.
  - DASHBOARD_PASSWORD — the password I'll use to log into my dashboard. I can choose anything.
  - ANTHROPIC_API_KEY — the key from Step 5
  - EUKA_STORE_ID — my store UUID from Step 4
  - EUKA_MCP_URL — https://app.euka.ai/api/mcp
  - EUKA_BEARER_TOKEN — my Euka bearer token from Step 4 (include "Bearer " prefix if it doesn't already start with it)
- After adding all variables, tell me to click Deploy

STEP 7 — Verify the deployment
- Tell me to wait for the deployment to finish (1–3 minutes) and look for a green checkmark
- Tell me to click the deployment URL (it will look like my-project.vercel.app)
- Tell me I should see a login page — log in with the DASHBOARD_PASSWORD I set
- If the login works and I see the dashboard, great! If not, walk me through troubleshooting (check env vars, redeploy)

STEP 8 — Connect Euka to Claude (for running reports)
- Explain that to actually pull data and generate reports, I need to connect my Euka account to Claude's MCP tool system
- Tell me this is a one-time setup done in Claude Desktop (not claude.ai web)
- Walk me through installing Claude Desktop from claude.ai/download if I don't have it
- Explain what MCP is in one sentence (it lets Claude call external tools — like Euka's API — directly)
- Walk me through adding the Euka MCP server to Claude Desktop:
  - Open Claude Desktop → Settings → Developer → Edit Config
  - Add the Euka MCP configuration (provide the exact JSON snippet to paste, using my EUKA_MCP_URL and EUKA_BEARER_TOKEN)
  - Save and restart Claude Desktop
- Tell me to open a new Claude Desktop conversation and ask "What tools do you have available?" — I should see Euka tools listed

STEP 9 — Run the first report
- Tell me to open the setup-kit/weekly-report-prompt.md file from the GitHub repo
- Explain that this is the prompt I paste into Claude Desktop (with Euka connected) each week
- Walk me through filling in the date windows for the current week
- Tell me to paste the filled-in prompt into Claude Desktop and let it run (it will take 5–20 minutes and output a large JSON)
- Tell me to copy the entire JSON output
- Walk me through how to paste it into the dashboard:
  - Go to my dashboard URL
  - Click Manual Entry (or go to the Manage page)
  - Paste the JSON and save
- Tell me I should now see my first report!

STEP 10 — Set up goals (optional but recommended)
- Tell me to go to the Manage page on my dashboard
- Walk me through the Goals & Targets section
- Explain what each goal type does (monthly GMV target shows progress bars in the Insights tab)
- Suggest starting with just a monthly GMV target and adding more over time

After completing all steps, summarize:
- My dashboard URL
- How to run a new report each week (paste the prompt into Claude Desktop → copy JSON → paste into dashboard)
- How to use the Live Refresh button for quick checks
- Where to get help if something breaks

Throughout this entire process:
- Use plain English, no jargon
- If I get confused or stuck, ask me to describe what I see on my screen
- Never assume I know how to do something — explain every click
- Celebrate small wins ("Great! That worked!")
- If something fails, help me troubleshoot before moving on
