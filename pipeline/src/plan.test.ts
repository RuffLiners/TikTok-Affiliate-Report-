import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RAW_VERSION, StoredPeriod, dailySpan, isSettled, planPulls, wantedPeriods } from './plan.js'

const asOf = '2026-11-09', dataThrough = '2026-11-08'
const wanted = wantedPeriods(asOf, dataThrough, '2026-01-01')
const store = (w: { type: 'week' | 'month'; key: string; start: string; end: string; partial: boolean }, over: Partial<StoredPeriod> = {}): StoredPeriod =>
  ({ period_type: w.type, period_key: w.key, start_date: w.start, end_date: w.end, raw: {}, raw_version: RAW_VERSION, final: !w.partial, ...over })

test('the year covers every complete week from the one holding Jan 1, plus every month since launch', () => {
  const weeks = wanted.filter(w => w.type === 'week'), months = wanted.filter(w => w.type === 'month')
  assert.equal(weeks.length, 45); assert.equal(weeks[0].start, '2026-11-01'); assert.equal(weeks[44].start, '2025-12-28')
  assert.equal(months[0].key, '2026-11'); assert.equal(months[months.length - 1].key, '2025-10')
})
test('first run with nothing stored pulls everything', () => {
  const p = planPulls(wanted, [])
  assert.equal(p.toPull.length, wanted.length); assert.equal(p.reused.length, 0)
})
test('later runs pull only what is missing or not settled', () => {
  // everything stored; only periods inside the 14 day settle window are non-final
  const stored = wanted.map(w => store(w, { final: isSettled(w.end, dataThrough, w.partial) }))
  const p = planPulls(wanted, stored)
  const pulledKeys = p.toPull.map(w => `${w.type}:${w.key}`).sort()
  assert.deepEqual(pulledKeys, ['month:2026-10', 'month:2026-11', 'week:2026-10-25', 'week:2026-11-01'])
  assert.equal(p.reused.length, wanted.length - 4)
})
test('a brand-new week appears next Monday and is the only new pull besides the unsettled ones', () => {
  const next = wantedPeriods('2026-11-16', '2026-11-15', '2026-01-01')
  const stored = wanted.map(w => store(w, { final: isSettled(w.end, dataThrough, w.partial) }))
  const p = planPulls(next, stored)
  assert.ok(p.toPull.some(w => w.key === '2026-11-08'))
  assert.equal(p.reasons['week:2026-11-08'], 'not stored yet')
})
test('a changed line definition invalidates stored periods', () => {
  const stored = wanted.map(w => store(w, { final: true, raw_version: RAW_VERSION - 1 }))
  assert.equal(planPulls(wanted, stored).toPull.length, wanted.length)
})
test('force refresh ignores everything stored', () => {
  const stored = wanted.map(w => store(w, { final: true }))
  assert.equal(planPulls(wanted, stored, { force: true }).toPull.length, wanted.length)
})
test('settling: a week is final 14 days after the cutoff, a partial month never', () => {
  assert.equal(isSettled('2026-10-24', dataThrough, false), true)
  assert.equal(isSettled('2026-10-31', dataThrough, false), false)
  assert.equal(isSettled('2026-11-08', dataThrough, true), false)
})
test('the daily series covers only the span of the periods being pulled', () => {
  assert.equal(dailySpan([]), null)
  const stored = wanted.map(w => store(w, { final: isSettled(w.end, dataThrough, w.partial) }))
  const span = dailySpan(planPulls(wanted, stored).toPull)!
  assert.equal(span.from, '2026-10-01'); assert.equal(span.to, '2026-11-08')
})
