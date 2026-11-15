import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareRaw, differs, lookbackStages, restatementCheck } from './drift.js'
import { RAW_VERSION, StoredPeriod } from './plan.js'

const dataThrough = '2026-11-08'
const wk = (start: string, end: string, raw = {}): StoredPeriod => ({ period_type: 'week', period_key: start, start_date: start, end_date: end, raw: { videos: 500, shopGmv: 10000, ...raw }, raw_version: RAW_VERSION, final: true })
const mo = (key: string, end: string, raw = {}): StoredPeriod => ({ period_type: 'month', period_key: key, start_date: `${key}-01`, end_date: end, raw: { videos: 2000, shopGmv: 40000, ...raw }, raw_version: RAW_VERSION, final: true })
// 20 final weeks back from Oct 24 and 6 final months back from Sep
const weeks = Array.from({ length: 20 }, (_, i) => { const end = new Date(Date.UTC(2026, 9, 24) - i * 7 * 864e5).toISOString().slice(0, 10); const start = new Date(Date.parse(end) - 6 * 864e5).toISOString().slice(0, 10); return wk(start, end) })
const months = [mo('2026-09', '2026-09-30'), mo('2026-08', '2026-08-31'), mo('2026-05', '2026-05-31'), mo('2026-02', '2026-02-28'), mo('2025-12', '2025-12-31')]
const stored = [...weeks, ...months]

test('tolerance: money within $1 or 0.1 percent is not a change; one video is', () => {
  assert.equal(differs('shopGmv', 10000, 10000.5), false)
  assert.equal(differs('shopGmv', 10000, 10011), true)
  assert.equal(differs('videos', 572, 573), true)
  assert.equal(differs('views', 2400982, 2400990), false)
  assert.equal(differs('views', null, 5), true)      // data appeared
  assert.equal(differs('views', null, null), false)
})
test('compareRaw ignores usage rights and contests', () => {
  assert.deepEqual(compareRaw({ videos: 5, usageRightsCreators: 1, contestAffiliates: 1 }, { videos: 5, usageRightsCreators: 99, contestAffiliates: 99 }), [])
})
test('stages are disjoint, newest first: previous period, 3 months, 6 months, full history', () => {
  const st = lookbackStages(stored, dataThrough)
  assert.deepEqual(st.map(s => s.name), ['previous period', 'last 3 months', 'last 6 months', 'full history'])
  assert.equal(st[0].periods.length, 3)                                  // 2 newest weeks + newest month
  const ids = st.flatMap(s => s.periods.map(p => `${p.period_type}:${p.period_key}`))
  assert.equal(new Set(ids).size, ids.length); assert.equal(ids.length, stored.length)
  assert.ok(st[3].periods.some(p => p.period_key === '2025-12'))
})
test('clean probe: only the previous period is re-pulled, nothing is replaced', async () => {
  const pulled: number[] = []
  const r = await restatementCheck(stored, dataThrough, async ps => { pulled.push(ps.length); return ps.map(p => ({ ...p })) })
  assert.deepEqual(pulled, [3]); assert.equal(r.clean, true); assert.equal(r.stageReached, 'previous period'); assert.equal(r.drift.length, 0); assert.equal(r.replaced.length, 0)
})
test('drift in the probe widens the look-back until a stage comes back clean', async () => {
  // Only the newest week changed. Probe finds it; 3-month stage is clean, so 6 months and full history are never pulled.
  const newest = weeks[0].period_key
  const pulledStages: string[] = []
  const r = await restatementCheck(stored, dataThrough, async ps => {
    pulledStages.push(String(ps.length))
    return ps.map(p => (p.period_key === newest ? { ...p, raw: { ...p.raw, shopGmv: 10500 } } : { ...p }))
  })
  assert.equal(r.clean, false); assert.equal(r.stageReached, 'last 3 months'); assert.equal(pulledStages.length, 2)
  assert.deepEqual(r.drift.map(d => [d.period_key, d.field, d.stored, d.fresh, d.stage]), [[newest, 'shopGmv', 10000, 10500, 'previous period']])
  assert.equal(r.replaced[0].raw.shopGmv, 10500); assert.equal(r.replaced[0].final, true)
})
test('drift that keeps appearing reaches full history', async () => {
  const r = await restatementCheck(stored, dataThrough, async ps => ps.map(p => ({ ...p, raw: { ...p.raw, videos: (p.raw.videos ?? 0) + 5 } })))
  assert.equal(r.stageReached, 'full history'); assert.equal(r.checked, stored.length); assert.equal(r.replaced.length, stored.length)
})
test('a replaced period keeps its contest and usage fields', async () => {
  const s = [wk('2026-10-18', '2026-10-24', { contestAffiliates: 31, usageRightsCreators: 8000 })]
  const r = await restatementCheck(s, dataThrough, async ps => ps.map(p => ({ ...p, raw: { ...p.raw, videos: 999, contestAffiliates: 0, usageRightsCreators: 0 } })))
  assert.equal(r.replaced[0].raw.contestAffiliates, 31); assert.equal(r.replaced[0].raw.usageRightsCreators, 8000); assert.equal(r.replaced[0].raw.videos, 999)
})
test('nothing stored: nothing to check', async () => {
  const r = await restatementCheck([], dataThrough, async () => { throw new Error('should not pull') })
  assert.equal(r.checked, 0); assert.equal(r.clean, true)
})
