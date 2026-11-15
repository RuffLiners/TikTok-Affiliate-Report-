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
export async function readState(key?: string): Promise<{ latest: { as_of: string; created_at: string } | null; snapshots: Array<{ snap_date: string; value: number }> }> {
  const res = await fetch(`${base()}/api/publish-report${key ? `?key=${key}` : ''}`, { headers: headers() })
  const body: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`state ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
  return body
}
export async function saveSnapshot(date: string, values: Record<string, number>): Promise<void> {
  await publish({ snapshotOnly: true, snapshot: { date, values } })
}
