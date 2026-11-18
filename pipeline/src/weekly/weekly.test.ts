import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeWindows, validateReportDate } from './windows.js'
import { parseCsv, checkColumns } from './csv.js'
import { emailBody, subject, STATUS_KEYS, finalStatus, writeOutputs, CANCELLED_STEP } from './status.js'
import { untracedDollars, noEmDash, SECTIONS } from './analysis.js'
import { enrich, agentRow, inWindow, UNENRICHED } from './agents.js'

// ---------- windows ----------
test('windows match the skill example for report date 2026-11-09 (Monday)', () => {
  const w = computeWindows('2026-11-09')
  assert.deepEqual(w.cur, ['2026-10-09', '2026-11-07'])
  assert.deepEqual(w.prior, ['2026-09-09', '2026-10-08'])
  assert.deepEqual(w.week, ['2026-11-01', '2026-11-07'])
  assert.equal(w.week_starts.length, 13)
  assert.equal(w.week_starts[0], '2026-08-09')
  assert.equal(w.week_starts[12], '2026-11-01')
  assert.deepEqual(w.months, [['Jun', '2026-06-01', '2026-06-30'], ['Jul', '2026-07-01', '2026-07-31'], ['Aug', '2026-08-01', '2026-08-31'],
    ['Sep', '2026-09-01', '2026-09-30'], ['Oct', '2026-10-01', '2026-10-31'], ['Nov*', '2026-11-01', '2026-11-09']])
})
test('every week start is a Sunday and the 30 days end on the week Saturday', () => {
  for (const d of ['2026-11-16', '2026-11-15', '2026-11-14', '2026-11-18', '2027-01-04']) {
    const w = computeWindows(d)
    for (const s of w.week_starts) assert.equal(new Date(s + 'T00:00:00Z').getUTCDay(), 0, `${d}: ${s}`)
    assert.equal(new Date(w.cur[1] + 'T00:00:00Z').getUTCDay(), 6)
    assert.ok(w.cur[1] < d, 'the week is complete before the report date')
    assert.equal(w.cur[1], w.week[1])
  }
  assert.deepEqual(computeWindows('2026-11-14').week, ['2026-11-01', '2026-11-07'], 'a Saturday report uses the previous complete week')
  assert.deepEqual(computeWindows('2027-01-04').months[0], ['Aug', '2026-08-01', '2026-08-31'], 'months cross the year')
})
test('bad report dates are rejected', () => {
  assert.throws(() => validateReportDate('2026-13-01', '2026-11-18'))
  assert.throws(() => validateReportDate('2026-02-30', '2026-11-18'))
  assert.throws(() => validateReportDate('11/16/2026', '2026-11-18'))
  assert.throws(() => validateReportDate('2026-11-19', '2026-11-18'), /future/)
  assert.throws(() => validateReportDate('2025-01-01', '2026-11-18'), /before/)
  validateReportDate('2026-11-16', '2026-11-18')
})

// ---------- CSV ----------
test('CSV keeps 19-digit IDs as exact text', () => {
  const csv = '﻿Video ID,Creator ID,Product ID,Creator,Video Revenue\n7571234567890123456,7494662528842958121,1731884838482449080,"a, b",12.5\n'
  const [r] = parseCsv(csv)
  assert.equal(r['Video ID'], '7571234567890123456')
  assert.equal(r['Creator ID'], '7494662528842958121')
  assert.equal(r['Product ID'], '1731884838482449080')
  assert.notEqual(String(Number(r['Video ID'])), r['Video ID'], 'as a number it would lose digits')
  assert.equal(r['Creator'], 'a, b')
  assert.equal(typeof r['Video Revenue'], 'string')
})
test('CSV handles quotes, embedded newlines and CRLF', () => {
  const rows = parseCsv('A,B\r\n"x ""q""","line1\nline2"\r\n1,2')
  assert.deepEqual(rows, [{ A: 'x "q"', B: 'line1\nline2' }, { A: '1', B: '2' }])
})
test('a missing export column fails loudly', () => {
  assert.throws(() => checkColumns('Video ID,Cost\n1,2', 'gmvmax'), /Gross revenue/)
  checkColumns('Video ID,Cost,Gross revenue\n1,2,3', 'gmvmax')
})

// ---------- status email ----------
test('email body has every key in order, none when empty, one line each', () => {
  const b = emailBody({ outcome: 'PUBLISHED', reportDate: '2026-11-16', weekWindow: '2026-11-08..2026-11-14', d30Window: '2026-10-16..2026-11-14', d30Gmv: 347522.449,
    audit: 'PASS', warnings: ['partial-month retention is shown;\nit will read low'], scorecard: 'OK', dashboardUrl: 'https://x/dashboard/2026-11-16', runUrl: 'https://gh/run/1' })
  const lines = b.split('\n')
  assert.deepEqual(lines.map(l => l.split(':')[0]), [...STATUS_KEYS])
  assert.equal(lines[3], 'd30Gmv: 347522.45')
  assert.equal(lines[5], 'auditFailures: none')
  assert.equal(lines[6], 'warnings: partial-month retention is shown; it will read low')
  assert.equal(lines[7], 'reviewFlags: none')
  assert.equal(lines[9], 'failedStep: none')
  assert.equal(subject({ outcome: 'PUBLISHED', reportDate: '2026-11-16' }), 'Weekly TikTok report: PUBLISHED 2026-11-16')
  assert.equal(subject({ outcome: 'PUBLISHED WITH REVIEW FLAGS', reportDate: '2026-11-16' }), 'Weekly TikTok report: PUBLISHED WITH REVIEW FLAGS 2026-11-16')
})
test('a run killed mid-step reports FAILED with the cancelled fallback step', () => {
  const s = finalStatus({ reportDate: '2026-11-16', currentStep: 'export_videos', weekWindow: '2026-11-08..2026-11-14' }, { dashboardUrl: 'https://d/', runUrl: 'https://gh/run/9' })
  assert.equal(s.outcome, 'FAILED')
  const b = emailBody(s)
  assert.match(b, new RegExp(`failedStep: ${CANCELLED_STEP.replace(/[()]/g, '\\$&')}`))
  assert.match(b, /error: run stopped during step "export_videos"/)
  assert.match(b, /dashboardUrl: https:\/\/d\/dashboard\/2026-11-16/)
  assert.match(b, /weekWindow: 2026-11-08\.\.2026-11-14/)
  assert.equal(subject(s), 'Weekly TikTok report: FAILED 2026-11-16')
  const none = finalStatus(null, {})
  assert.equal(none.outcome, 'FAILED'); assert.equal(subject(none), 'Weekly TikTok report: FAILED unknown')
})
test('a caught failure keeps its own failed step', () => {
  const s = finalStatus({ reportDate: '2026-11-16', finished: true, outcome: 'FAILED', failedStep: 'audit', error: 'x' }, {})
  assert.match(emailBody(s), /failedStep: audit/)
})
test('GITHUB_OUTPUT gets subject and a heredoc body', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'wk-')), 'out')
  writeOutputs({ outcome: 'FAILED', reportDate: '2026-11-16', failedStep: 'windows', error: 'bad date' }, f)
  const t = readFileSync(f, 'utf8')
  assert.match(t, /^subject=Weekly TikTok report: FAILED 2026-11-16$/m)
  assert.match(t, /body<<__STATUS_EOF__\nreportDate: 2026-11-16\n[\s\S]*runUrl: none\n__STATUS_EOF__/)
})

// ---------- analysis tracing ----------
test('dollar tracing uses the audit tolerance', () => {
  const pool = [52532.85, 347522.45, 1200]
  assert.deepEqual(untracedDollars('Angel earned $52.5K and $347,522.45 total, plus $1,200.', pool), [])
  assert.deepEqual(untracedDollars('a projection of $410K and $999', pool), ['$410K', '$999'])
})
test('em dashes are removed from every section', () => {
  const a = Object.fromEntries(SECTIONS.map(s => [s, 'GMV rose \u2014 again'])) as any
  for (const s of SECTIONS) assert.equal(noEmDash(a)[s], 'GMV rose, again')
})

// ---------- agents ----------
const detail = { campaign: { target_gmvs: ['$20.0K-$2.0M'], target_categories: ['Pet Supplies'], target_gender: null, target_follower_counts: [], target_creator_languages: ['en'],
  target_collab_free_samples: true, product_commission_with_percentage: [{ commission: 20 }, { commission: 20 }], include_shop_ads: true, shop_ads_commission: [{ commission: 10 }], products: ['1', '2'] },
  lists: [{ name: '2026-W47 G1 Lapsed earners' }], legacyLists: [], segments: [] }
test('agent enrichment maps the get_outreach_agent fields', () => {
  const e = enrich(detail)
  assert.deepEqual(e, { gmv_filter: '$20.0K-$2.0M', kw_filter: 'Pet Supplies', other_filters: 'creator languages: en', list_segment: '2026-W47 G1 Lapsed earners', commission_display: '20% / 10%', product_count: 2 })
  assert.throws(() => enrich({}), /no campaign/)
  const row = agentRow({ id: 5, campaign_name: 'x', created_time: '2026-11-17T05:00:00+00:00', total_conversations: 3 }, 'crm', UNENRICHED)
  assert.equal(row.date_posted, '2026-11-16', 'created date is Pacific')
  assert.equal(row.gmv_filter, 'not enriched')
})
test('agents are kept inside the window by Pacific date, deduplicated, newest first', () => {
  const rows = [
    { a: { id: 1, created_time: '2026-10-16T08:00:00Z' }, type: 'outreach' as const },
    { a: { id: 2, created_time: '2026-10-16T06:00:00Z' }, type: 'outreach' as const }, // Oct 15 Pacific
    { a: { id: 3, created_time: '2026-11-10T00:00:00Z' }, type: 'crm' as const },
    { a: { id: 3, created_time: '2026-11-10T00:00:00Z' }, type: 'crm' as const },
  ]
  assert.deepEqual(inWindow(rows, '2026-10-16', '2026-11-14').map(r => r.a.id), [3, 1])
})
