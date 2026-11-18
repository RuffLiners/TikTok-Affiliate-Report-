import type { StoredPeriod } from './plan.js'
import type { ContestMonth } from './contests.js'
import type { DriftRow } from './drift.js'

function base(): string {
  const u = (process.env.DASHBOARD_URL || '').replace(/\/$/, '')
  if (!u) throw new Error('DASHBOARD_URL is not set')
  return u
}
function headers() {
  const t = (process.env.REPORT_PUBLISH_TOKEN || '').trim()
  if (!t) throw new Error('REPORT_PUBLISH_TOKEN is not set')
  return { 'content-type': 'application/json', authorization: `Bearer ${t}` }
}
export async function publish(report: unknown): Promise<any> {
  const res = await fetch(`${base()}/api/publish-report`, { method: 'POST', headers: headers(), body: JSON.stringify(report) })
  const body: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`publish ${res.status}: ${JSON.stringify(body).slice(0, 600)}`)
  return body
}
export async function readState(key?: string, withStore = false): Promise<{ latest: { as_of: string; created_at: string } | null; snapshots: Array<{ snap_date: string; value: number }>; periods: StoredPeriod[]; contestMonths: ContestMonth[] }> {
  const q = [key ? `key=${key}` : '', withStore ? 'periods=1&contests=1' : ''].filter(Boolean).join('&')
  const res = await fetch(`${base()}/api/publish-report${q ? `?${q}` : ''}`, { headers: headers() })
  const body: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`state ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
  return body
}
export async function saveSnapshot(date: string, values: Record<string, number>): Promise<void> {
  await publish({ snapshotOnly: true, snapshot: { date, values } })
}
export async function saveStore(periods: StoredPeriod[], contestMonths: ContestMonth[], drift: DriftRow[], runDate: string): Promise<{ saved: number; final: number }> {
  return publish({ periodsOnly: true, periods, contestMonths, drift, runDate })
}
/**
 * Weekly report only (no scorecard): POST { reportOnly: true, audit: { status: 'PASS' }, ...report }. The server re-runs
 * validateGeneratedReport, the review flags and reconciliation. A 2xx with needsReview means saved, live page not updated.
 */
export async function publishReport(report: unknown): Promise<{ ok: boolean; reportDate: string; needsReview: string[]; liveUpdated?: boolean }> {
  const res = await fetch(`${base()}/api/publish-report`, { method: 'POST', headers: headers(), body: JSON.stringify(report) })
  const body: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`publish ${res.status}: ${JSON.stringify(body).slice(0, 600)}`)
  if (!Array.isArray(body.needsReview)) throw new Error('publish: the dashboard did not return needsReview (is the reportOnly route deployed?)')
  return body
}
