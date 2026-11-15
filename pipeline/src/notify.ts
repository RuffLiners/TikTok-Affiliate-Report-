import { slack } from './slack.js'

/**
 * Failure, stuck or drift alert. Slack here (the webhook posts to #social-media); the email to brandon@ruffliners.com
 * is sent by the workflow's `if: failure()` step, which also covers a crash before this code runs.
 */
export async function alert(kind: 'FAILED' | 'STUCK' | 'DRIFT', text: string): Promise<void> {
  const url = process.env.DASHBOARD_URL ? ` ${process.env.DASHBOARD_URL}/dashboard` : ''
  await slack(`:rotating_light: *Weekly scorecard ${kind}*\n${text}\nNothing was published.${url}\nAn email has been sent to brandon@ruffliners.com.`)
}
