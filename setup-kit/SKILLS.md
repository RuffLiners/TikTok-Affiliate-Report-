# TikTok Affiliate Dashboard — Skills & Capabilities

## What This Tool Does

This is a private, branded analytics dashboard for TikTok Shop affiliate programs. It pulls live data from your Euka account, runs AI analysis with Claude, and presents everything in a clean weekly report format — no spreadsheets, no manual copy-pasting.

---

## Core Capabilities

### Live 30-Day Dashboard
- **Overview KPIs**: Total GMV, Orders, Videos Posted, Total Views — all vs. prior 30 days
- **Creator KPIs**: Creators Posted, New Creators (first-ever post), Retention Rate
- **By Creator Tier**: Three tiers (G1 <$25K global GMV, G2 $25K–$100K, G3 >$100K) with full breakdowns
- **GMV Max**: Ad Spend, Ad Revenue, ROI — with spend broken down by content age
- **Recruiting**: Messages Sent and Samples Shipped, broken down by tier
- **Top 15 Creators** by Store GMV (with followers, views, videos, orders, AOV, engagement)
- **Top 15 Videos** by GMV (with product, views, orders, AOV, likes, comments)
- **Most Active Creators** by Videos Posted
- **Outreach & CRM Agents** created in the last 30 days with full metrics

### Weekly Reports (saved snapshots)
Each saved report includes all of the above PLUS:
- **Weekly 13-Week Charts**: GMV trend, views, creators by tier, videos by tier, GMV by tier, retention rate, recruiting
- **Monthly 6-Month Charts**: Same metrics across 6 months
- **AI Analysis** (4 sections):
  - **Performance**: This week's headlines, MTD/QTD progress vs goals
  - **Creator Highlights**: Breakout creators, top content, tier productivity
  - **Recruiting Priorities**: Reactivation targets, outreach mix, sample recommendations
  - **Growth Opportunities**: Trend direction, primary growth engines, risks, 4-week outlook

### Insights Tab
- Last week snapshot
- **Target Tracker**: Progress bars for every goal — GMV (monthly + quarterly), Videos (by tier), Samples, GMV Max Spend, GMV Max ROI, Active Creators — each showing MTD actual, projected end-of-month, and target with On Track / At Risk / Off Track status

---

## What It Is NOT

- Not a real-time dashboard (data is pulled on demand via the Refresh button)
- Not a campaign management tool (you manage campaigns in Euka; this reports on them)
- Not connected to TikTok directly (all data comes through Euka's API)
- Not multi-store (one deployment = one store)

---

## Data Sources

| Data | Source |
|------|--------|
| Affiliate GMV, Orders, Videos, Views | Euka → `creator_store_performance` |
| Total account GMV (shopGmv) | Euka → `get_dashboard_performance_overview` → `totalShopGMV` |
| Affiliate GMV from overview (affiliateGmv) | Euka → `get_dashboard_performance_overview` → `totalAffiliateGMV` |
| Creator tier classification | Euka → global gmv_30d per creator |
| Outreach agents | Euka → list_outreach_agents + get_outreach_agent |
| GMV Max (ad data) | Euka → get_dashboard_ads_overview |
| Samples shipped/approved | Euka → outreach agent data |
| Messages sent | Euka → outreach overview metrics |
| AI analysis | Claude (Anthropic) with your data as context |

> **Field name note**: The overview endpoint returns `totalShopGMV` (not `totalGmv`). See `setup-kit/field-map.md` for the full API→report field mapping and guardrail rules.

---

## How Reports Are Generated

### Option A — Automated (via + New Report button)
Claude runs 20 sequential data-pull phases automatically, each pulling a specific slice of data from Euka, then assembles and saves the full report. Takes ~15–25 minutes.

### Option B — Manual (paste JSON)
You run the weekly report prompt in Claude Desktop (or claude.ai with Euka MCP connected), Claude pulls all the data and returns a single JSON object, you paste it into the dashboard via the Manual Entry button or the `scripts/insert-report.ts` script.

### Live Refresh
The Live 30 Day dashboard has a "Refresh live data" button that runs a faster 11-phase job pulling the current 30-day KPIs, tables, and agents without generating weekly/monthly charts or analysis.

---

## Creator Tier System

Creators are automatically classified based on their **global TikTok Shop GMV in the last 30 days** (across all stores, not just yours):

| Tier | Global GMV Range | Typical Profile |
|------|-----------------|-----------------|
| G1 | < $25,000 | Micro/nano creators, new to affiliate |
| G2 | $25,000 – $100,000 | Mid-tier, consistent performers |
| G3 | > $100,000 | Top creators, high-volume sellers |

---

## GMV Fields in the Report

The report tracks GMV from two sources:

| Field | What it measures | Used for |
|-------|-----------------|----------|
| `gmv` | Affiliate-only GMV from `creator_store_performance` | Backward-compat; 30d tier breakdowns |
| `shopGmv` | Total account GMV (`totalShopGMV` from overview) | **Target tracker** — includes affiliate + product cards + in-house |
| `affiliateGmv` | Affiliate-only from overview (`totalAffiliateGMV`) | Shown as a sub-line on targets page when shopGmv is available |

The dashboard shows **both** Total GMV and Affiliate GMV tiles in the Last 30 Days tab so you can see the full picture.

---

## Configurable Goals (Insights Tab)

Set any combination of these targets in the Manage page:
- Monthly GMV target + period label (compared against Total account GMV / shopGmv)
- Quarterly GMV target
- Monthly videos (total + by tier G1/G2/G3)
- Monthly samples approved
- Monthly + quarterly GMV Max spend budget
- Monthly + quarterly GMV Max ROI target
- Active creators per tier (30-day)
