// Monday run: pull on typed tools, build, audit twice (TypeScript rules + independent Python audit with range-level controls),
// re-pull from source once if the audit fails (never hand-edit numbers), publish, then post to Slack.
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Euka } from './euka.js'
import { buildControls, pullScorecardRaw } from './pull.js'
import { publish, readState } from './publish.js'
import { alert } from './notify.js'
import { slack } from './slack.js'
import { laToday } from './dates.js'
import { addDays, auditScorecard, buildScorecard, Scorecard, LINES } from '../../tiktok-dashboard/src/lib/scorecard/index'

const CACHE = process.env.PIPELINE_CACHE_DIR || join(process.cwd(), '.cache')
const money = (n: number | null) => (n == null ? 'no data' : '$' + Math.round(n).toLocaleString('en-US'))

function pythonAudit(reportPath: string, controlsPath: string) {
  const r = spawnSync('python3', [join(process.cwd(), 'py', 'audit_report.py'), reportPath, controlsPath], { encoding: 'utf8' })
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

async function once(asOf: string, dataThrough: string, usageSnaps: Array<{ snap_date: string; value: number }>) {
  const e = await Euka.connect()
  try {
    const { raw, gaps } = await pullScorecardRaw(e, asOf, dataThrough, usageSnaps)
    const sc = buildScorecard(raw, [])
    const ts = auditScorecard(sc)
    const controls = await buildControls(e, asOf, dataThrough)
    const dir = join(CACHE, asOf); mkdirSync(dir, { recursive: true })
    const report = { meta: { reportDate: asOf, label: `Scorecard ${asOf}`, dataWindow: `Oct 2025 to ${dataThrough}` }, scorecard: sc, scorecardRaw: raw }
    const rp = join(dir, 'report.json'), cp = join(dir, 'controls.json')
    writeFileSync(rp, JSON.stringify(report)); writeFileSync(cp, JSON.stringify(controls))
    const py = pythonAudit(rp, cp)
    return { raw, sc, ts, py, report, gaps }
  } finally { await e.close().catch(() => {}) }
}

async function main() {
  const asOf = laToday(), dataThrough = addDays(asOf, -1)
  const state = await readState('usageRightsCreators').catch(() => ({ latest: null, snapshots: [] as Array<{ snap_date: string; value: number }> }))
  let run = await once(asOf, dataThrough, state.snapshots)
  if (run.ts.failures.length > 0 || !run.py.pass) {
    // Fix from source: drop every cached pull and re-pull. Never edit a number.
    console.error('Audit failed; re-pulling from source once.\n' + run.ts.failures.join('\n') + '\n' + run.py.out)
    rmSync(join(CACHE, asOf), { recursive: true, force: true })
    run = await once(asOf, dataThrough, state.snapshots)
  }
  if (run.ts.failures.length > 0 || !run.py.pass) {
    await alert('FAILED', `Audit still failing after one re-pull from source.\n\`\`\`${[...run.ts.failures, run.py.out].join('\n').slice(0, 1800)}\`\`\``)
    process.exit(1)
  }
  const report = { ...run.report, audit: { status: 'PASS', failures: [], warnings: run.ts.warnings.slice(0, 50), checks: ['typescript-rules', 'python-independent-audit'], gaps: run.gaps.slice(0, 50) } }
  const res = await publish(report)
  await slack(summary(asOf, run.sc, run.py.out, run.gaps, res.issues ?? run.sc.issues))
  console.log('published', asOf, `${LINES.length} lines`)
}

main().catch(async (err: Error) => {
  console.error(err)
  await alert('FAILED', `${String(err.message).slice(0, 1500)}`)
  process.exit(1)
})
