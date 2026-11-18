// reportOnly mode of the token publish route: auth, audit gate, and a golden report saved through saveReportCore
// (real validation, review flags and reconciliation; Supabase replaced by an in-memory fake).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const writes: Array<{ table: string; row: any }> = []
function fakeSupabase() {
  const chain = (table: string): any => {
    const q: any = {
      select: () => q, eq: () => q, lt: () => q, order: () => q, limit: () => q,
      single: async () => ({ data: null, error: null }), maybeSingle: async () => ({ data: null, error: null }),
      upsert: async (row: any) => { writes.push({ table, row }); return { error: null } },
      insert: async (row: any) => { writes.push({ table, row }); return { error: null } },
      then: (res: any) => res({ data: [], error: null }),
    }
    return q
  }
  return { from: (t: string) => chain(t) }
}
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: () => fakeSupabase() }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/scorecardStore', () => ({ loadManualEntries: async () => [] }))

const { POST } = await import('./route')
const TOKEN = 'test-token-123'
const golden = () => JSON.parse(readFileSync(join(process.cwd(), 'reports/2026-08-24/manual-report-2026-08-24.json'), 'utf8'))
const req = (body: unknown, auth: string | null = `Bearer ${TOKEN}`) =>
  new Request('http://x/api/publish-report', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) }) as any

describe('POST /api/publish-report reportOnly', () => {
  beforeEach(() => { writes.length = 0; process.env.REPORT_PUBLISH_TOKEN = TOKEN })

  it('401 without a token, nothing saved', async () => {
    const res = await POST(req({ ...golden(), reportOnly: true, audit: { status: 'PASS' } }, null))
    expect(res.status).toBe(401); expect(writes).toEqual([])
    const bad = await POST(req({ ...golden(), reportOnly: true, audit: { status: 'PASS' } }, 'Bearer wrong'))
    expect(bad.status).toBe(401); expect(writes).toEqual([])
  })
  it('422 when the audit is not PASS, nothing saved', async () => {
    const res = await POST(req({ ...golden(), reportOnly: true, audit: { status: 'FAIL', failures: ['x'] } }))
    expect(res.status).toBe(422); expect(writes).toEqual([])
    const missing = await POST(req({ ...golden(), reportOnly: true }))
    expect(missing.status).toBe(422)
  })
  it('200 on a golden report: saved through saveReportCore, scorecards untouched, review flags returned', async () => {
    const res = await POST(req({ ...golden(), reportOnly: true, audit: { status: 'PASS', failures: [], warnings: [] } }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, reportDate: '2026-08-24' })
    expect(Array.isArray(body.needsReview)).toBe(true)
    expect(writes.some(w => w.table === 'weekly_reports' && w.row.report_date === '2026-08-24')).toBe(true)
    expect(writes.some(w => w.table === 'scorecards')).toBe(false)
    const saved = writes.find(w => w.table === 'weekly_reports')!.row
    expect(saved.d30.meta.source).toBe('scheduled-publish')
    expect(saved).not.toHaveProperty('reportOnly')
  })
  it('422 when the server-side validation rejects the numbers, nothing saved', async () => {
    const g = golden(); g.d30.tiers.l1.gmv += 5000 // tiers no longer reconcile to d30.gmv
    const res = await POST(req({ ...g, reportOnly: true, audit: { status: 'PASS' } }))
    expect(res.status).toBe(422); expect(writes.filter(w => w.table === 'weekly_reports')).toEqual([])
  })
  it('the scorecard path still requires scorecardRaw', async () => {
    const res = await POST(req({ ...golden(), audit: { status: 'PASS' } }))
    expect(res.status).toBe(400)
  })
})
