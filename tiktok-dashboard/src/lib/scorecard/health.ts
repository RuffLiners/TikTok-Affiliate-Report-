// Is the published scorecard trustworthy right now? The publish-time audit only checks the scorecard's own arithmetic.
// This looks at what surrounds it: missing periods, outdated definitions, a stalled run, a store newer than what is
// published, an empty Euka Chat input, and whether an alert could even be delivered. Pure, so it is unit-tested.
export interface HealthInput {
  /** Result of the scorecard's own rules. */
  scorecardAudit: 'PASS' | 'FAIL' | null
  missingFromStore: string[]
  outdatedDefinition: string[]
  lastRun: { status: string; lastProgress: string; message?: string | null } | null
  publishedAt: string | null
  /** Newest pulled_at among stored periods. */
  newestPulledAt: string | null
  /** Periods that hold a line 7 value. */
  line7Periods: number
  eukaChatConversations: number
  alerts: { slack: boolean; email: boolean; missing: string[] }
  cronReady: boolean
}
export interface Health { status: 'PASS' | 'WARN' | 'FAIL'; problems: Array<{ level: 'FAIL' | 'WARN'; text: string }> }

export function scorecardHealth(i: HealthInput): Health {
  const p: Health['problems'] = []
  const fail = (text: string) => p.push({ level: 'FAIL', text }), warn = (text: string) => p.push({ level: 'WARN', text })
  const some = (l: string[]) => `${l.slice(0, 4).join(', ')}${l.length > 4 ? ` and ${l.length - 4} more` : ''}`
  if (i.scorecardAudit === null) fail('No scorecard has been published.')
  if (i.scorecardAudit === 'FAIL') fail('The published scorecard fails its own rules.')
  if (i.missingFromStore.length) fail(`${i.missingFromStore.length} period(s) are missing from the store (${some(i.missingFromStore)}). Run the backfill.`)
  if (i.outdatedDefinition.length) fail(`${i.outdatedDefinition.length} stored period(s) use an old definition and are left out of the scorecard (${some(i.outdatedDefinition)}). Run the backfill.`)
  if (i.lastRun?.status === 'stalled') fail(`The last run stalled (last progress ${i.lastRun.lastProgress}). Click Resume.`)
  if (i.lastRun?.status === 'failed') fail(`The last run failed: ${i.lastRun.message ?? 'see the Manage tab'}. Click Resume.`)
  if (i.lastRun?.status === 'cancelled') warn('The last run was stopped before it finished.')
  if (i.lastRun?.status === 'running') warn('A run is in progress; the scorecard updates when it finishes.')
  if (i.publishedAt && i.newestPulledAt && Date.parse(i.newestPulledAt) > Date.parse(i.publishedAt) + 1000) fail(`The store was updated (${i.newestPulledAt}) after the scorecard was published (${i.publishedAt}), so what is shown may not match what is stored. Finish the run to republish.`)
  if (i.line7Periods > 0 && i.eukaChatConversations === 0) fail(`${i.line7Periods} period(s) hold a "Euka Chat messages sent" value but no Euka Chat conversations were read, so those values are not Euka Chat counts.`)
  if (!i.alerts.slack && !i.alerts.email) fail(`No alert channel is set up, so a failed or stalled run is silent. Add in Vercel: ${i.alerts.missing.join(', ')}.`)
  else if (i.alerts.missing.length) warn(`Only one alert channel is set up. Still missing in Vercel: ${i.alerts.missing.join(', ')}.`)
  if (!i.cronReady) warn('CRON_SECRET is not set in Vercel: the Monday run, daily snapshot and stall watchdog are off.')
  return { status: p.some(x => x.level === 'FAIL') ? 'FAIL' : p.length ? 'WARN' : 'PASS', problems: p }
}
