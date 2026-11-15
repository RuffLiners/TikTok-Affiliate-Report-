import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeAds, mergeSeries, sumRange, chunks, snapshotOnOrAfter, DailyMap } from './daily.js'

// Euka rows for the control week, Nov 1 to 7 2026 (typed tool output read during the build)
const series = { data: {
  videoPosted: [92, 91, 80, 79, 82, 67, 81].map((v, i) => ({ date: `2026-11-0${i + 1}`, videos_posted: v })),
  performances: [11191.34, 3423.09, 3311.24, 6006.93, 8588.22, 11363.17, 7946.98].map((v, i) => ({ date: `2026-11-0${i + 1}`, total_shop_gmv: v })),
  analyticsAggregated: [10237, 11933, 10740, 8156, 10017, 7352, 9745].map((v, i) => ({ date: `2026-11-0${i + 1}`, messages_sent: v, target_invites: 1, emails_sent: i < 3 ? 0 : 50 })),
} }
const ads = { dailyRoas: [[3548.12, 12932.33], [1270.36, 3929.7], [1672.87, 4303.72], [2112.77, 6753.87], [2864.69, 9990.6], [3742.89, 12667.36], [2871.78, 9253.73]]
  .map(([cost, revenue], i) => ({ date: `2026-11-0${i + 1}`, cost, revenue })) }

test('daily sums reproduce the control week', () => {
  const d: DailyMap = {}; mergeSeries(d, series); mergeAds(d, ads)
  assert.equal(sumRange(d, '2026-11-01', '2026-11-07', 'videos'), 572)
  assert.equal(sumRange(d, '2026-11-01', '2026-11-07', 'messages'), 68180)
  assert.equal(sumRange(d, '2026-11-01', '2026-11-07', 'shopGmv'), 51830.97)
  assert.equal(sumRange(d, '2026-11-01', '2026-11-07', 'spend'), 18083.48)
  assert.equal(sumRange(d, '2026-11-01', '2026-11-07', 'revenue'), 59831.31)
  assert.equal(sumRange(d, '2026-11-01', '2026-11-07', 'emails'), 200)
})
test('a period with no data is null, never 0', () => {
  const d: DailyMap = {}; mergeSeries(d, series)
  assert.equal(sumRange(d, '2025-10-26', '2025-11-01', 'messages'), null)
})
test('a period with a missing day is null and the gap is reported', () => {
  const d: DailyMap = {}; mergeSeries(d, series); delete d['2026-11-04'].messages
  const gaps: string[] = []
  assert.equal(sumRange(d, '2026-11-01', '2026-11-07', 'messages', {}, gaps), null)
  assert.match(gaps[0], /6 of 7 days/)
})
test('ads history: days before the history start are not gaps, but a wholly earlier period is null', () => {
  const d: DailyMap = {}
  for (const day of ['2025-10-28', '2025-10-29', '2025-10-30', '2025-10-31']) d[day] = { spend: 100 }
  assert.equal(sumRange(d, '2025-10-01', '2025-10-31', 'spend', { historyFrom: '2025-10-28' }), 400)
  assert.equal(sumRange(d, '2025-10-01', '2025-10-20', 'spend', { historyFrom: '2025-10-28' }), null)
})
test('zero spend that the source reported stays a real 0', () => {
  const d: DailyMap = { '2026-01-01': { spend: 0 }, '2026-01-02': { spend: 0 } }
  assert.equal(sumRange(d, '2026-01-01', '2026-01-02', 'spend'), 0)
})
test('chunks cover the span without overlap', () => {
  const c = chunks('2026-01-01', '2026-03-10', 31)
  assert.deepEqual(c[0], ['2026-01-01', '2026-01-31']); assert.equal(c[c.length - 1][1], '2026-03-10')
})
test('snapshot lookup takes the first snapshot on or just after the date', () => {
  const s = [{ snap_date: '2026-11-02', value: 10 }, { snap_date: '2026-11-03', value: 12 }]
  assert.equal(snapshotOnOrAfter(s, '2026-11-02'), 10)
  assert.equal(snapshotOnOrAfter(s, '2026-10-20'), null)
})
