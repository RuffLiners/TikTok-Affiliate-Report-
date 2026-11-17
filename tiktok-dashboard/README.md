This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Scorecard backfill (Manage tab)

An admin can pull the whole scorecard history from Euka without GitHub Actions: Admin, Manage tab, "Scorecard backfill".

- Engine: `src/lib/scorecard/engine/` (plan, pull, contests, drift, backfill). `pipeline/src/*.ts` re-exports it, so the GitHub "Weekly scorecard" run and the in-dashboard run share one copy. Metric definitions live only in `src/lib/scorecard/`.
- Route: `POST /api/admin/scorecard-backfill` with `action` = `start` (`year_start`, `force_refresh`), `proof` (latest complete week only), `step` (`run_id`), `resume`, `cancel`. `GET` returns progress. Each step saves its batch before the next, so a stopped run resumes.
- Euka auth: direct MCP client with `EUKA_BEARER_TOKEN` and `EUKA_MCP_URL` (`src/lib/server/eukaClient.ts`). Check it with `GET /api/admin/euka-probe`.
- Lock and run state: `app_config` rows `scorecard_backfill_lock` and `scorecard_backfill_state`. No schema change.
- Publishing writes straight to `scorecards`; `REPORT_PUBLISH_TOKEN` is not used by the in-dashboard run.
- Alerts (run failed, no progress for 10 minutes, finished with missing periods) go to Slack and email. Env vars: `SLACK_WEBHOOK_URL` (webhook bound to #social-media), `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, optional `ALERT_EMAIL_TO`. `CRON_SECRET` enables the 5 minute stall watchdog in `vercel.json`. Anything missing is shown in red in the panel.
- Tests: `npm test` (`src/lib/scorecard/engine/backfill.test.ts` covers chunking, resume, the lock, skip-if-stored, no data, stall).
- Scheduled on Vercel Cron (`vercel.json`, all need `CRON_SECRET`): `/api/cron/scorecard-weekly` Mondays 15:07 UTC with a retry at 17:07 (same engine, pulls only what is missing or unsettled, publishes, posts a Slack summary); `/api/cron/scorecard-snapshot` daily (usage-rights count); `/api/cron/scorecard-watchdog` every 5 minutes (continues an unfinished cron run, stall alert, alert when the newest scorecard is over 8 days old). These replace the GitHub workflows, which can be disabled.
