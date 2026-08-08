// Golden-week regression test (audit Finding 4): diff a freshly generated
// report against a frozen, hand-verified historical week. Run it after ANY
// change to the master prompt, the phase prompts, the model version, or the
// Euka schema — it is the only way to prove a change didn't break accuracy.
//
// Usage:
//   npx tsx scripts/golden-diff.ts golden/golden.json candidate.json
//   npx tsx scripts/golden-diff.ts golden/golden.json --db 2026-07-14
//
// --db fetches the candidate straight from weekly_reports by report_date
// (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local).
//
// Tolerances: counts must match exactly; money/views within ±2% (attribution
// lag makes GMV wobble slightly between pulls); retention within ±0.5 pts.
// Exit code 0 = all checks pass, 1 = at least one failed.
import { readFileSync } from 'fs'
import { config } from 'dotenv'
config({ path: '.env.local' })

type Check = { name: string; golden: number; candidate: number; kind: 'exact' | 'pct2' | 'pts' }

const num = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}
const get = (obj: any, path: string) => path.split('.').reduce((o, k) => o?.[k], obj)

function buildChecks(golden: any, cand: any): Check[] {
  const checks: Check[] = []
  const add = (name: string, path: string, kind: Check['kind']) =>
    checks.push({ name, golden: num(get(golden, path)), candidate: num(get(cand, path)), kind })

  // ~25 key numbers, mirroring the weekly run checklist
  add('30d affiliate GMV', 'd30.gmv', 'pct2')
  add('30d shop GMV', 'd30.shopGmv', 'pct2')
  add('30d orders', 'd30.orders', 'exact')
  add('30d videos', 'd30.videos', 'exact')
  add('30d views', 'd30.views', 'pct2')
  add('30d creators', 'd30.creators', 'exact')
  add('30d new creators', 'd30.newCreators', 'exact')
  add('30d retention', 'd30.retention', 'pts')
  add('30d messages', 'd30.msgs', 'exact')
  add('30d samples', 'd30.samples', 'exact')
  add('GMV Max spend', 'd30.gmvMax.spend', 'pct2')
  add('GMV Max revenue', 'd30.gmvMax.revenue', 'pct2')
  for (const l of [1, 2, 3, 4, 5, 6, 7]) {
    add(`L${l} tier GMV`, `d30.tiers.l${l}.gmv`, 'pct2')
    add(`L${l} tier creators`, `d30.tiers.l${l}.creators`, 'exact')
  }
  const gw: unknown[] = golden?.weekly_charts?.gmv ?? []
  const cw: unknown[] = cand?.weekly_charts?.gmv ?? []
  gw.forEach((v, i) => checks.push({ name: `week ${i + 1}/13 GMV`, golden: num(v), candidate: num(cw[i]), kind: 'pct2' }))
  return checks
}

function passes(c: Check): boolean {
  if (c.kind === 'exact') return c.golden === c.candidate
  if (c.kind === 'pts') return Math.abs(c.golden - c.candidate) <= 0.5
  const base = Math.max(Math.abs(c.golden), Math.abs(c.candidate))
  return base === 0 || (Math.abs(c.golden - c.candidate) / base) * 100 <= 2
}

async function loadCandidate(arg: string, dbDate?: string): Promise<any> {
  if (arg !== '--db') return JSON.parse(readFileSync(arg, 'utf-8'))
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data, error } = await supabase.from('weekly_reports').select('*').eq('report_date', dbDate!).single()
  if (error || !data) throw new Error(`No report for ${dbDate}: ${error?.message}`)
  return data
}

async function main() {
  const [goldenPath, candArg, dbDate] = process.argv.slice(2)
  if (!goldenPath || !candArg) {
    console.error('Usage: npx tsx scripts/golden-diff.ts <golden.json> <candidate.json | --db YYYY-MM-DD>')
    process.exit(2)
  }
  const golden = JSON.parse(readFileSync(goldenPath, 'utf-8'))
  const cand = await loadCandidate(candArg, dbDate)

  const gv = golden?.d30?.meta?.promptVersion, cv = cand?.d30?.meta?.promptVersion
  console.log(`promptVersion  golden=${gv ?? 'unstamped'}  candidate=${cv ?? 'unstamped'}\n`)

  const checks = buildChecks(golden, cand)
  let failed = 0
  for (const c of checks) {
    const ok = passes(c)
    if (!ok) failed++
    console.log(`${ok ? '  PASS' : '✗ FAIL'}  ${c.name.padEnd(22)} golden=${c.golden.toLocaleString('en-US')}  candidate=${c.candidate.toLocaleString('en-US')}  (${c.kind})`)
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
  if (failed) {
    console.error(`\n${failed} check(s) FAILED — the prompt/model/schema change broke accuracy. Do not ship it.`)
    process.exit(1)
  }
}

main().catch(e => { console.error(e.message); process.exit(2) })
