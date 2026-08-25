// Assemble a weekly_reports row from raw phase data using the exact
// production code path (src/lib/assembleReport.ts), then run every gate on
// it: the hard validation (V1–V13), the review flags (swings, tier-sum $1,
// round-number spot-checks), and the softer reconcile warnings. Used for the
// golden-week test and for offline regenerations.
//
// Usage: npx tsx scripts/assemble-row.ts <phase-data.json> <today YYYY-MM-DD> <out.json>
import { readFileSync, writeFileSync } from 'fs'
import { todayInReportTz, buildWindows, assemble } from '../src/lib/assembleReport'
import { validateGeneratedReport } from '../src/lib/validateReport'
import { collectReviewFlags, tierDefinitionNote } from '../src/lib/sanityDiff'
import { reconcileD30 } from '../src/lib/reconcile'

const [pdPath, today, out] = process.argv.slice(2)
if (!pdPath || !today || !out) {
  console.error('Usage: npx tsx scripts/assemble-row.ts <phase-data.json> <today YYYY-MM-DD> <out.json>')
  process.exit(2)
}
const pd = JSON.parse(readFileSync(pdPath, 'utf-8'))
const w = buildWindows(todayInReportTz(today))
const analysis = { performance: pd.performance || '', creators: pd.creators || '', recruiting: pd.recruiting || '', growth: pd.growth || '' }
const row: any = assemble(w, pd, analysis)

const issues = validateGeneratedReport(row)
console.log('HARD GATE (V1-V13):', issues.length ? issues : 'ALL PASS')
const flags = collectReviewFlags(row, null)
console.log('REVIEW FLAGS:', flags.length ? flags.map(f => `${f.key} — ${f.text}`) : 'none')
const recon = reconcileD30(row.d30)
console.log('reconcileD30:', recon.length ? recon : 'clean')
const tn = tierDefinitionNote(row.d30)
if (tn) console.log('TIER NOTE:', tn)

writeFileSync(out, JSON.stringify(row, null, 2))
console.log('wrote', out)
if (issues.length) process.exit(1)
