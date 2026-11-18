// The status email is a contract: a Claude watchdog parses it. One `key: value` per line, always every key,
// `none` when empty, in this order. Subject is exactly one of three forms.
import { appendFileSync } from 'node:fs'

export const STATUS_KEYS = ['reportDate', 'weekWindow', 'd30Window', 'd30Gmv', 'audit', 'auditFailures', 'warnings', 'reviewFlags', 'scorecard', 'failedStep', 'error', 'dashboardUrl', 'runUrl'] as const
export type StatusKey = typeof STATUS_KEYS[number]
export type Outcome = 'PUBLISHED' | 'PUBLISHED WITH REVIEW FLAGS' | 'FAILED'

export interface Status {
  outcome: Outcome
  reportDate: string
  weekWindow?: string
  d30Window?: string
  d30Gmv?: number | null
  audit?: 'PASS' | 'FAIL' | null
  auditFailures?: string[]
  warnings?: string[]
  reviewFlags?: string[]
  scorecard?: 'OK' | 'NOT PUBLISHED TODAY' | null
  failedStep?: string | null
  error?: string | null
  dashboardUrl?: string | null
  runUrl?: string | null
}

/** One line per value: no newlines inside a value, list items joined with " | ". */
const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
const list = (xs?: string[]) => (xs && xs.length ? xs.map(clean).filter(Boolean).join(' | ') || 'none' : 'none')
const val = (x: unknown) => (x === null || x === undefined || x === '' ? 'none' : clean(String(x)))

export function subject(s: Pick<Status, 'outcome' | 'reportDate'>): string {
  return `Weekly TikTok report: ${s.outcome} ${s.reportDate || 'unknown'}`
}

export function statusFields(s: Status): Record<StatusKey, string> {
  return {
    reportDate: val(s.reportDate),
    weekWindow: val(s.weekWindow),
    d30Window: val(s.d30Window),
    d30Gmv: s.d30Gmv == null ? 'none' : s.d30Gmv.toFixed(2),
    audit: val(s.audit),
    auditFailures: list(s.auditFailures),
    warnings: list(s.warnings),
    reviewFlags: list(s.reviewFlags),
    scorecard: val(s.scorecard),
    failedStep: s.outcome === 'FAILED' ? val(s.failedStep ?? 'unknown') : 'none',
    error: val(s.error),
    dashboardUrl: val(s.dashboardUrl),
    runUrl: val(s.runUrl),
  }
}

export function emailBody(s: Status): string {
  const f = statusFields(s)
  return STATUS_KEYS.map(k => `${k}: ${f[k]}`).join('\n')
}

/** Write subject and body to $GITHUB_OUTPUT so the workflow's email step sends exactly this, whatever happens next. */
export function writeOutputs(s: Status, file = process.env.GITHUB_OUTPUT): void {
  const body = emailBody(s)
  const out = `subject=${subject(s)}\noutcome=${s.outcome}\nbody<<__STATUS_EOF__\n${body}\n__STATUS_EOF__\n`
  if (file) appendFileSync(file, out)
  // Run page summary: the same subject and key: value lines, readable without email
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (file && summary) appendFileSync(summary, `### ${subject(s)}\n\n\`\`\`\n${body}\n\`\`\`\n`)
  console.log(`\n${subject(s)}\n${body}\n`)
}

/** Fallback body for a cancelled or timed-out run, built by the workflow from whatever keys were last written. */
export const CANCELLED_STEP = 'unknown (run cancelled or timed out)'

/**
 * Progress file: the run rewrites it at every step, so a run killed mid-step (cancel, timeout, crash) still leaves
 * the windows, the step it was in and the error. `npm run weekly-status` turns it into the email in an `always()` step.
 */
export interface Progress extends Partial<Status> { reportDate: string; currentStep?: string; finished?: boolean }

export function progressPath(): string {
  return process.env.WEEKLY_STATUS_FILE || `${process.env.RUNNER_TEMP || '.cache'}/weekly-status.json`
}

/** Final status from a progress file; an unfinished run is FAILED with the cancelled/timed-out fallback step. */
export function finalStatus(p: Progress | null, env: { reportDate?: string; dashboardUrl?: string; runUrl?: string } = {}): Status {
  const reportDate = p?.reportDate || env.reportDate || 'unknown'
  const base = {
    dashboardUrl: env.dashboardUrl ? `${env.dashboardUrl.replace(/\/$/, '')}/dashboard/${reportDate}` : null,
    runUrl: env.runUrl ?? null,
  }
  if (p?.finished && p.outcome) return { ...base, ...p, outcome: p.outcome, reportDate } as Status
  return {
    ...base, ...(p ?? {}), reportDate, outcome: 'FAILED', audit: p?.audit ?? null,
    failedStep: CANCELLED_STEP,
    error: p?.error ?? (p?.currentStep ? `run stopped during step "${p.currentStep}"` : 'run stopped before the report step started'),
  }
}
