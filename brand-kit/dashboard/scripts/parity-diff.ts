// Auto/manual parity proof.
//
// Both report paths must produce identical numbers for the same data window:
//   AUTO   = phase data → assemble() (the exact production code, imported
//            from src/lib/assembleReport.ts) → weekly_reports row
//   MANUAL = the skill's JSON output → the save-report mapping
//            (meta/weeklyCharts/monthlyCharts → row columns)
//
// Usage:
//   npx tsx scripts/parity-diff.ts <phase-data.json> <manual-report.json> [--today YYYY-MM-DD]
//
// Exit 0 = byte-identical rows except the allowed provenance fields
// (d30.meta.generatedAt, d30.meta.source/savedAt, validation — the skill's
// self-check object, which the save path drops). Exit 1 = any other diff.
import { readFileSync } from 'fs'
import { todayInReportTz, buildWindows, assemble } from '../src/lib/assembleReport'

const args = process.argv.slice(2)
const todayFlag = args.indexOf('--today')
const today = todayFlag !== -1 ? args.splice(todayFlag, 2)[1] : undefined
const [phasePath, manualPath] = args
if (!phasePath || !manualPath) {
  console.error('Usage: npx tsx scripts/parity-diff.ts <phase-data.json> <manual-report.json> [--today YYYY-MM-DD]')
  process.exit(2)
}

const pd = JSON.parse(readFileSync(phasePath, 'utf-8'))
const manual = JSON.parse(readFileSync(manualPath, 'utf-8'))

// ── AUTO path: production assemble() over the phase data ──────────────────
const w = buildWindows(todayInReportTz(today ?? manual?.meta?.reportDate))
const analysis = {
  performance: pd.performance ?? manual?.analysis?.performance ?? '',
  creators: pd.creators ?? manual?.analysis?.creators ?? '',
  recruiting: pd.recruiting ?? manual?.analysis?.recruiting ?? '',
  growth: pd.growth ?? manual?.analysis?.growth ?? ''
}
const autoRow: any = assemble(w, pd, analysis)

// ── MANUAL path: the save-report mapping over the skill JSON ───────────────
const manualRow: any = {
  report_date: manual.meta.reportDate,
  label: manual.meta.label,
  data_window: manual.meta.dataWindow,
  d30: manual.d30,
  weekly_charts: manual.weeklyCharts,
  monthly_charts: manual.monthlyCharts,
  tables: manual.tables,
  agents: manual.agents || [],
  analysis: manual.analysis
}
// save-report carries the skill's meta stamps into d30.meta
manualRow.d30.meta = {
  promptVersion: manual.meta.promptVersion,
  weekWindow: manual.meta.weekWindow,
  d30Window: manual.meta.d30Window,
  priorWindow: manual.meta.priorWindow,
  timezone: manual.meta.timezone,
  generatedAt: manual.meta.generatedAt,
  ...(manualRow.d30.meta || {})
}

// ── Deep diff ───────────────────────────────────────────────────────────────
// Only acceptable differences: generation timestamps and per-path provenance.
const IGNORED = new Set([
  'd30.meta.generatedAt',
  'd30.meta.source',
  'd30.meta.savedAt'
])

const diffs: string[] = []
function walk(a: any, b: any, path: string) {
  if (IGNORED.has(path)) return
  const bothNum = typeof a === 'number' && typeof b === 'number'
  if (bothNum) {
    if (Object.is(a, b) || Math.abs(a - b) < 1e-9) return
    diffs.push(`${path}: auto=${a} manual=${b}`)
    return
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a === b) return
    // undefined vs missing key is equal for our purposes
    if ((a === undefined && b === undefined)) return
    diffs.push(`${path}: auto=${JSON.stringify(a)} manual=${JSON.stringify(b)}`)
    return
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    const av = a[k], bv = b[k]
    if (av === undefined && bv === undefined) continue
    walk(av, bv, path ? `${path}.${k}` : k)
  }
}
walk(autoRow, manualRow, '')

if (diffs.length) {
  console.error(`✗ PARITY FAILED — ${diffs.length} difference(s) beyond the allowed provenance fields:\n`)
  for (const d of diffs.slice(0, 100)) console.error('  ' + d)
  if (diffs.length > 100) console.error(`  … and ${diffs.length - 100} more`)
  process.exit(1)
}
console.log('✓ PARITY OK — auto (assemble) and manual (save-report mapping) rows are identical; only d30.meta.generatedAt/source/savedAt may differ.')
