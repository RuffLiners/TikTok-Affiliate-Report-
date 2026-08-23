# Affiliate Pulse — share prompt

Send the message below to a brand owner after sharing the artifact with them
(open https://claude.ai/code/artifact/35115a26-f52a-4d49-bdb5-6dfc2b2019cd →
share menu → add their email). The artifact link only opens for people it has
been shared with.

---

## Message to send

Subject: Free weekly TikTok Shop affiliate report (2-min setup)

Hey — I use a weekly report that pulls my TikTok Shop affiliate numbers
straight out of Euka: GMV and orders with week-over-week changes, creator
growth split by level (emerging vs. established vs. power sellers), outreach
funnel, retention, and my top creators and videos. I had it made into a page
any brand can run on their own data, and I've shared it with you.

You need: a claude.ai account and a Euka account with your TikTok Shop
connected. Your data stays yours — the page reads it with your own Euka
login and stores nothing.

Setup (one time):

1. In claude.ai go to Settings → Connectors → Add custom connector.
   Name it exactly: Euka
   URL: https://app.euka.ai/api/mcp
   Sign in with your Euka account when it asks.
2. Open the report link I shared:
   https://claude.ai/code/artifact/35115a26-f52a-4d49-bdb5-6dfc2b2019cd
   and click Allow when Claude asks to let the page use your Euka connector.
3. That's it. Every Monday, just open the same link — it auto-loads your most
   recent complete week.

If anything doesn't work, paste this into a new Claude chat and it will walk
you through it:

> I'm setting up a shared "Affiliate Pulse" weekly TikTok Shop affiliate
> report that runs as a Claude artifact against my Euka account. Act as my
> setup assistant, one step at a time:
> 1. Help me add the Euka connector in claude.ai (Settings → Connectors →
>    Add custom connector, name it exactly "Euka", URL
>    https://app.euka.ai/api/mcp), signing in with my Euka account. My
>    TikTok Shop must already be connected inside Euka — check that with me
>    first.
> 2. Once connected, verify it works by calling the Euka tool
>    list_accessible_brands and telling me which brands you can see.
> 3. Then tell me to open my shared report link and click Allow on the
>    connector prompt: https://claude.ai/code/artifact/35115a26-f52a-4d49-bdb5-6dfc2b2019cd
> 4. If the page says "Connect Euka to get started" even after setup,
>    troubleshoot with me: the connector must be named exactly "Euka", my
>    Euka plan must include API/MCP access, and the artifact must have been
>    shared with the claude.ai account I'm logged into.
> Don't ask me for any API keys or tokens — the connector sign-in handles
> auth. My data is only read, never stored.

---

## Notes for the sender

- The artifact can't be shared publicly (it uses a connector), so add each
  recipient in the artifact's share menu before sending this.
- Recipients on Euka plans without MCP/API access will get an error from the
  connector sign-in — that's an Euka plan question, not a setup mistake.
- For brand owners you can't share a claude.ai link with, hand them the
  self-hosted `brand-kit/` from this repo instead.
