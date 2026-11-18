// Monday run: pull on typed tools, build, audit twice (TypeScript rules + independent Python audit with range-level controls),
// re-pull from source once if the audit fails (never hand-edit numbers), publish, then post to Slack.
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Euka } from './euka.js'
import { buildControls, pullPeriods, pullScorecardRaw } from './pull.js'
import { publish, readState, saveStore } from './publish.js'
import type { StoredPeriod, Wanted } from './plan.js'
import type { ContestMonth } from './contests.js'
import { DriftRow, RestatementResult, restatementCheck } from './drift.js'
import { alert } from './notify.js'
import { slack } from './slack.js'
import { laToday } from './dates.js'
import { addDays, auditScorecard, buildScorecard, Scorecard, LINES } from '../../tiktok-dashboard/src/lib/scorecard/index'

const CACHE = process.env.PIPELINE_CACHE_DIR || join(process.cwd(), '.cache')
const money = (n: number | null) => (n == null ? 'no data' : '$' + Math.round(n).toLocaleString('en-US'))

function pythonAudit(reportPath: string, controlsPath: string) {
  const r = spawnSync('python3', [join(process.cwd(), 'py', 'audit_scorecard.py'), reportPath, controlsPath], { encoding: 'utf8' })
  const out = (r.stdout || '') + (r.stderr || '')
  return { pass: r.status === 0 && /AUDIT: PASS/.test(out), out }
}

function summary(asOf: string, sc: Scorecard, py: string, warnings: string[], issues: Array<{ severity: string; text: string }>): string {
  const w = sc.weekly[0], m = sc.monthly[0]
  const L = (p: typeof w, k: string) => (p.lines as any)[k].value as number | null
  const warn = issues.filter(i => i.severity === 'warn').map(i => `• ${i.text}`)
  const lines = [
    `:white_check_mark: *Weekly scorecard published for ${asOf}*`,
    `${process.env.DASHBOARD_URL ? process.env.DASHBOARD_URL.replace(/\/$/, '') + '/dashboard' : '(DASHBOARD_URL not set)'}`,
    `Audit: *PASS* (TypeScript rules and independent Python audit with Euka range-level controls)`,
    `Week ${w.start} to ${w.end}: Gross Revenue ${money(L(w, 'grossRevenue'))}, GMV ${money(L(w, 'gmv'))}, GMV Max spend ${money(L(w, 'gmvMaxSpend'))}, ROI ${L(w, 'gmvMaxRoi') ?? 'no data'} (vs shop GMV ${w.roiVsShopGmv ?? 'n/a'})`,
    `${m.key} month to date (${m.daysElapsed}/${m.daysInMonth} days), straight-line estimate: Gross Revenue ${money(m.projected?.grossRevenue ?? null)}, spend ${money(m.projected?.gmvMaxSpend ?? null)}`,
  ]
  lines.push(warn.length ? `*Issues to resolve (${warn.length}):*\n${warn.join('\n')}` : 'No open issues.')
  const spot = sc.sellerCenterCheck
  lines.push(`Seller Center spot-check (${spot.period}): ${spot.rows.every(r => r.status === 'no_seller_center_value') ? 'no Seller Center values entered yet' : spot.flagged ? `${spot.flagged} line(s) over ${spot.thresholdPct}%` : 'all compared lines within tolerance'}`)
  if (warnings.length) lines.push(`Warnings:\n${warnings.slice(0, 8).map(x => `• ${x}`).join('\n')}`)
  return lines.join('\n')
}

const toWanted = (p: StoredPeriod): Wanted => ({ type: p.period_type, key: p.period_key, start: p.start_date, end: p.end_date, partial: false })

async function once(asOf: string, dataThrough: string, yearStart: string, usageSnaps: Array<{ snap_date: string; value: number }>, stored: StoredPeriod[], storedContests: ContestMonth[], force: boolean) {
  const e = await Euka.connect()
  try {
    const pr = await pullScorecardRaw(e, asOf, dataThrough, yearStart, usageSnaps, stored, storedContests, force)
    // Restatement check: re-pull the newest final periods; widen the look-back if TikTok changed anything (a forced run just re-pulled everything)
    const noCheck: RestatementResult = { stageReached: 'skipped (full refresh)', checked: 0, drift: [], replaced: [], clean: true }
    const rs = force ? noCheck : await restatementCheck(pr.reused, dataThrough, async ps =>
      (await pullPeriods(e, asOf, dataThrough, ps.map(toWanted), { ...pr.ctx, contestFor: () => null })).periods)
    for (const p of rs.replaced) (p.period_type === 'week' ? pr.raw.weeks : pr.raw.months)[p.period_key] = p.raw
    const toSave = [...pr.fresh, ...rs.replaced]
    const sc = buildScorecard(pr.raw, [])
    const ts = auditScorecard(sc)
    const controls = await buildControls(e, asOf, dataThrough)
    const dir = join(CACHE, asOf); mkdirSync(dir, { recursive: true })
    const report = { meta: { reportDate: asOf, label: `Scorecard ${asOf}`, dataWindow: `Oct 2025 to ${dataThrough}` }, scorecard: sc, scorecardRaw: pr.raw, restatement: { stageReached: rs.stageReached, checked: rs.checked, changes: rs.drift.length, periodsChanged: rs.replaced.length } }
    const rp = join(dir, 'report.json'), cp = join(dir, 'controls.json')
    writeFileSync(rp, JSON.stringify(report)); writeFileSync(cp, JSON.stringify(controls))
    const py = pythonAudit(rp, cp)
    return { raw: pr.raw, sc, ts, py, report, gaps: pr.gaps, toSave, contestMonthsFresh: pr.contestMonthsFresh, pulledCount: pr.pulledCount, reusedCount: pr.reusedCount, rs }
  } finally { await e.close().catch(() => {}) }
}

function restatementLine(rs: RestatementResult): string {
  if (!rs.checked) return `Restatement check: ${rs.stageReached}.`
  if (rs.clean) return `Restatement check: re-pulled ${rs.checked} stored period(s) (${rs.stageReached}); nothing changed.`
  const top = (rs.drift as DriftRow[]).slice(0, 5).map(d => `${d.period_type} ${d.period_key} ${d.field}: ${d.stored ?? 'no data'} to ${d.fresh ?? 'no data'}`).join('; ')
  const wide = rs.stageReached === 'full history' ? ' Drift reached full history: review before trusting older periods.' : ''
  return `:warning: Restatement check: TikTok changed ${rs.drift.length} value(s) in ${rs.replaced.length} settled period(s); look-back widened to ${rs.stageReached}, ${rs.checked} period(s) re-pulled and updated. ${top}.${wide}`
}

async function main() {
  const asOf = laToday(), dataThrough = addDays(asOf, -1)
  // YEAR_START lets a backfill reach further back; by default the scorecard covers the current calendar year
  const yearStart = process.env.YEAR_START || `${asOf.slice(0, 4)}-01-01`
  const force = process.env.FORCE_REFRESH === '1'
  const state = await readState('usageRightsCreators', true).catch(() => ({ latest: null, snapshots: [] as Array<{ snap_date: string; value: number }>, periods: [] as StoredPeriod[], contestMonths: [] as ContestMonth[] }))
  console.log(`stored periods: ${state.periods.length}, stored contest months: ${state.contestMonths.length}, force refresh: ${force}`)
  let run = await once(asOf, dataThrough, yearStart, state.snapshots, state.periods, state.contestMonths, force)
  if (run.ts.failures.length > 0 || !run.py.pass) {
    // Fix from source: drop every cached pull, ignore stored periods, and re-pull. Never edit a number.
    console.error('Audit failed; re-pulling from source once.\n' + run.ts.failures.join('\n') + '\n' + run.py.out)
    rmSync(join(CACHE, asOf), { recursive: true, force: true })
    run = await once(asOf, dataThrough, yearStart, state.snapshots, state.periods, state.contestMonths, true)
  }
  if (run.ts.failures.length > 0 || !run.py.pass) {
    await alert('FAILED', `Audit still failing after one re-pull from source.\n\`\`\`${[...run.ts.failures, run.py.out].join('\n').slice(0, 1800)}\`\`\``)
    process.exit(1)
  }
  // Only audited pulls become permanent
  const saved = await saveStore(run.toSave, run.contestMonthsFresh, run.rs.drift, asOf)
  const report = { ...run.report, audit: { status: 'PASS', failures: [], warnings: run.ts.warnings.slice(0, 50), checks: ['typescript-rules', 'python-independent-audit'], gaps: run.gaps.slice(0, 50) } }
  const res = await publish(report)
  await slack(summary(asOf, run.sc, run.py.out, run.gaps, res.issues ?? run.sc.issues) + `\n${restatementLine(run.rs)}\nData: pulled ${run.pulledCount} period(s) from Euka, reused ${run.reusedCount} stored (${saved.final} newly final).`)
  console.log('published', asOf, `${LINES.length} lines; pulled ${run.pulledCount}, reused ${run.reusedCount}`)
}

main().catch(async (err: Error) => {
  console.error(err)
  await alert('FAILED', `${String(err.message).slice(0, 1500)}`)
  process.exit(1)
})
