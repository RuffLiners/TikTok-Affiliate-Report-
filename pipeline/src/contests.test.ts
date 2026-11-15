import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ContestInfo, ContestMonth, contestCounts, contestFor, monthIsFinal, resolveContestMonths } from './contests.js'

const c = (id: number, type: string, status: string, startDate: string, endDate: string): ContestInfo => ({ id, type, status, startDate, endDate })
const all = [
  c(1, 'ranking', 'completed', '2026-09-01', '2026-09-30'), c(2, 'ranking', 'completed', '2026-09-01', '2026-09-30'),
  c(3, 'ranking', 'completed', '2026-09-16', '2026-09-30'), c(4, 'retainer', 'completed', '2026-09-01', '2026-09-30'),
  c(5, 'posting', 'active', '2026-11-01', '2026-11-30'), c(6, 'ranking', 'canceled', '2026-10-01', '2026-10-31'),
]
const ids: Record<number, string[]> = { 1: ['a', 'b', 'c'], 2: ['b', 'c', 'd'], 3: ['c', 'e'], 4: ['zz'], 5: ['a', 'f'], 6: ['q'] }

test('a creator in several campaigns in the same month counts once', async () => {
  const { months } = await resolveContestMonths(all, [], '2026-11-14', async id => ids[id])
  const sep = months.find(m => m.month === '2026-09')!
  assert.deepEqual(sep.creator_ids, ['a', 'b', 'c', 'd', 'e'])           // a,b,c,b,c,d,c,e -> 5 distinct
  assert.equal(contestCounts(months).byMonth['2026-09'], 5)
})
test('retainers and canceled contests are not counted', async () => {
  const { months } = await resolveContestMonths(all, [], '2026-11-14', async id => ids[id])
  assert.ok(!months.some(m => m.creator_ids.includes('zz') || m.creator_ids.includes('q')))
  assert.equal(months.some(m => m.month === '2026-10'), false)
})
test('finished months are stored and never re-pulled; the active month is', async () => {
  const first = await resolveContestMonths(all, [], '2026-11-14', async id => ids[id])
  assert.equal(first.months.find(m => m.month === '2026-09')!.final, true)
  assert.equal(first.months.find(m => m.month === '2026-11')!.final, false)
  const fetched: number[] = []
  const second = await resolveContestMonths(all, first.months, '2026-11-14', async id => { fetched.push(id); return ids[id] })
  assert.deepEqual(fetched, [5])                                           // only the November contest
  assert.deepEqual(second.fresh.map(m => m.month), ['2026-11'])
})
test('a month is not final until 14 days after its contests ended', () => {
  const sep = all.slice(0, 3)
  assert.equal(monthIsFinal(sep, '2026-10-10'), false)
  assert.equal(monthIsFinal(sep, '2026-10-14'), true)
  assert.equal(monthIsFinal([c(9, 'ranking', 'active', '2026-09-01', '2026-09-30')], '2026-12-01'), false)
})
test('no data before the first contest month, a real zero after it', async () => {
  const { months } = await resolveContestMonths(all, [], '2026-11-14', async id => ids[id])
  const k = contestCounts(months)
  assert.equal(contestFor(k, '2026-05'), null); assert.equal(contestFor(k, '2026-09'), 5); assert.equal(contestFor(k, '2026-10'), 0)
})
test('all-time is the distinct union across months', async () => {
  const { months } = await resolveContestMonths(all, [], '2026-11-14', async id => ids[id])
  assert.equal(contestCounts(months).allTime, 6)                           // a,b,c,d,e (Sep) + f (Nov); a repeats
})
