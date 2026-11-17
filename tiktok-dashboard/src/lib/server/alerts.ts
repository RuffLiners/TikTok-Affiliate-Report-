// Alerts for the scorecard backfill: Slack (#social-media webhook) and email. Each channel reports whether it was
// delivered, so a missing env var is shown in the panel instead of failing silently.
export const ALERT_EMAIL_TO = (process.env.ALERT_EMAIL_TO || 'brandon@ruffliners.com').trim()

export interface AlertConfig { slack: boolean; email: boolean; missing: string[] }
export function alertConfig(): AlertConfig {
  const slack = !!(process.env.SLACK_WEBHOOK_URL || '').trim()
  const email = !!(process.env.RESEND_API_KEY || '').trim() && !!(process.env.ALERT_EMAIL_FROM || '').trim()
  const missing = [
    ...(slack ? [] : ['SLACK_WEBHOOK_URL']),
    ...((process.env.RESEND_API_KEY || '').trim() ? [] : ['RESEND_API_KEY']),
    ...((process.env.ALERT_EMAIL_FROM || '').trim() ? [] : ['ALERT_EMAIL_FROM']),
  ]
  return { slack, email, missing }
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<string> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) })
    return res.ok ? 'sent' : `failed: HTTP ${res.status}`
  } catch (e) { return `failed: ${String((e as Error).message).slice(0, 120)}` }
}

const TITLES = { FAILED: 'Scorecard run FAILED', STALLED: 'Scorecard run STALLED', MISSING: 'Scorecard run finished with missing periods', OVERDUE: 'Weekly scorecard is OVERDUE' } as const

export async function sendBackfillAlert(kind: keyof typeof TITLES, text: string): Promise<{ slack: string; email: string }> {
  const title = TITLES[kind]
  const link = process.env.DASHBOARD_URL ? `${process.env.DASHBOARD_URL.replace(/\/$/, '')}/admin` : process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/admin` : ''
  const cfg = alertConfig()
  const [slack, email] = await Promise.all([
    cfg.slack
      ? post(process.env.SLACK_WEBHOOK_URL!.trim(), {}, { text: `:rotating_light: *${title}*\n${text}${link ? `\n${link}` : ''}` })
      : Promise.resolve('not sent: SLACK_WEBHOOK_URL is not set in Vercel'),
    cfg.email
      ? post('https://api.resend.com/emails', { authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}` }, { from: process.env.ALERT_EMAIL_FROM!.trim(), to: [ALERT_EMAIL_TO], subject: title, text: `${text}${link ? `\n\n${link}` : ''}` })
      : Promise.resolve(`not sent: ${cfg.missing.filter(m => m !== 'SLACK_WEBHOOK_URL').join(' and ')} not set in Vercel`),
  ])
  if (slack !== 'sent' || email !== 'sent') console.error(`[scorecard-backfill] ALERT ${kind} (slack: ${slack}; email: ${email}): ${text}`)
  return { slack, email }
}

/** A plain Slack message (the Monday success summary). Returns whether it was delivered. */
export async function sendSlack(text: string): Promise<string> {
  const url = (process.env.SLACK_WEBHOOK_URL || '').trim()
  if (!url) return 'not sent: SLACK_WEBHOOK_URL is not set in Vercel'
  return post(url, {}, { text })
}
