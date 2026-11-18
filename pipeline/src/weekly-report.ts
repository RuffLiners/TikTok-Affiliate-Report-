// Weekly report, Monday GitHub run (npm run weekly-report). Code does every number; Claude writes only the prose.
// Steps (SKILL.md Phases 1 to 6): windows, pulls, agents, build (build_report.py), re-engagement, analysis, audit
// (audit_report.py), publish on PASS only. Each step is cached to .cache/<reportDate>/<step>.json so a failed run
// resumes, and retried 3 times (60 s wait on HTTP 429). Never edits a number to pass the audit.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { BRAND_ID, Euka } from './euka.js'
import { publishReport, readState } from './publish.js'
import { slack } from './slack.js'
import { laToday } from './dates.js'
import { computeWindows, validateReportDate, laDate, Windows } from './weekly/windows.js'
import { checkColumns, REQUIRED_COLUMNS } from './weekly/csv.js'
import { agentRow, enrich, inWindow, UNENRICHED, Enrichment } from './weekly/agents.js'
import { deriveFacts } from './weekly/derived.js'
import { numbersIn, writeAnalysis } from './weekly/analysis.js'
import { Progress, Status, progressPath, writeOutputs, finalStatus } from './weekly/status.js'
import { computeReengagement, reengagementNumbers, relevantTags, ReMember, ReList, ReTag } from '../../tiktok-dashboard/src/lib/reengagement'

const ROOT = process.env.PIPELINE_CACHE_DIR || join(process.cwd(), '.cache')
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const r2 = (x: number) => Math.round(x * 100) / 100

// ---------- progress (feeds the status email even if the run is killed) ----------
let progress: Progress = { reportDate: '' }
function setProgress(patch: Partial<Progress>) {
  progress = { ...progress, ...patch }
  try { mkdirSync(join(progressPath(), '..'), { recursive: true }); writeFileSync(progressPath(), JSON.stringify(progress, null, 1)) } catch (e) { console.error('progress write failed', e) }
}

// ---------- step = cache + 3 retries ----------
let DIR = ''
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  setProgress({ currentStep: name })
  const file = join(DIR, `${name}.json`)
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as T
  let last: unknown
  for (let i = 0; i <= 3; i++) {
    try {
      const out = await fn()
      mkdirSync(DIR, { recursive: true }); writeFileSync(file, JSON.stringify(out))
      return out
    } catch (e) {
      last = e
      if (i === 3) break
      const wait = /\b429\b|rate limit/i.test(String((e as Error)?.message)) ? 60_000 : 10_000 * (i + 1)
      console.warn(`step ${name} attempt ${i + 1} failed: ${(e as Error)?.message}; retrying in ${wait / 1000}s`)
      await sleep(wait)
    }
  }
  throw new Error(`${name}: ${(last as Error)?.message ?? last}`)
}
const dropCache = (pred: (step: string) => boolean) => {
  if (!existsSync(DIR)) return
  for (const f of readdirSync(DIR)) if (f.endsWith('.json') && pred(f.slice(0, -5))) rmSync(join(DIR, f))
}

// ---------- Euka helpers ----------
let E: Euka
const call = (name: string, args: Record<string, unknown>) => E.call(name, { brandId: BRAND_ID, ...args })

async function waitTask(taskId: string, label: string) {
  for (let i = 0; i < 120; i++) {
    const st = await call('get_task_status', { taskId })
    const s = String(st?.status ?? '').toLowerCase()
    if (s === 'succeeded' || s === 'completed' || s === 'success') return
    if (['failed', 'error', 'canceled', 'cancelled'].includes(s)) throw new Error(`${label} export ${s}: ${JSON.stringify(st).slice(0, 300)}`)
    await sleep(5000)
  }
  throw new Error(`${label} export did not finish in 10 minutes`)
}
async function download(url: string, dest: string, kind: keyof typeof REQUIRED_COLUMNS) {
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) })
  if (!res.ok) throw new Error(`download ${kind} HTTP ${res.status}`)
  const text = await res.text()
  checkColumns(text, kind)
  mkdirSync(join(dest, '..'), { recursive: true }); writeFileSync(dest, text)
  return { file: dest, bytes: text.length }
}
/** export_videos -> task -> URL -> CSV in dl/. Returns the file path (IDs stay text: the CSV is written as is). */
async function exportVideos(name: string, scope: Record<string, unknown>, kind: 'lifetime' | 'commerceWindow') {
  const dest = join(DIR, 'dl', `${name}.csv`)
  const meta = await step(`export_${name}`, async () => {
    const start = await call('export_videos', { scope })
    if (!start?.taskId) throw new Error(`export_videos ${name}: no taskId (${JSON.stringify(start).slice(0, 200)})`)
    await waitTask(start.taskId, name)
    const link = await call('get_video_export_download_url', { taskId: start.taskId })
    if (link?.truncated) throw new Error(`${name} export was truncated by Euka`)
    return download(String(link?.url ?? link?.downloadUrl), dest, kind)
  })
  if (!existsSync(meta.file)) { dropCache(s => s === `export_${name}`); return exportVideos(name, scope, kind) }
  return meta.file
}

// ---------- pulls (SKILL.md Phase 2) ----------
const range = (a: string, b: string) => ({ startDate: a, endDate: b })
const LV = ['activeCreators', 'videos', 'totalGmv', 'invitesSent', 'samplesDelivered', 'samplesApproved'] as const
/** Level breakdown -> 7 rows of 6 numbers, L1..L7. A level Euka leaves out had no activity (zeros, logged). */
function levelRows(resp: any, label: string): number[][] {
  const tiers: any[] = resp?.tiers
  if (!Array.isArray(tiers) || !tiers.length) throw new Error(`level breakdown ${label}: no tiers in response`)
  return Array.from({ length: 7 }, (_, i) => {
    const t = tiers.find(x => String(x.tier).toUpperCase() === `L${i + 1}`)
    if (!t) console.warn(`level breakdown ${label}: L${i + 1} absent, counted as zero`)
    return LV.map(f => Number(t?.[f] ?? 0) || 0)
  })
}
async function levels(label: string, a: string, b: string) {
  return levelRows(await step(`levels_${label}`, () => call('get_dashboard_creator_level_breakdown', { postedDateRange: range(a, b) })), label)
}
/** Performance overview with the shop-GMV guardrail; a 429 inside shopGmvError waits a minute and retries (3 times). */
async function overview(label: string, a: string, b: string, compare: boolean) {
  return step(`overview_${label}`, async () => {
    let o: any
    for (let i = 0; i < 4; i++) {
      o = await call('get_dashboard_performance_overview', { ...range(a, b), compareTo: compare ? { type: 'previous_period' } : { type: 'none' } })
      if (!/429/.test(String(o?.shopGmvError ?? ''))) break
      if (i < 3) { console.warn(`overview ${label}: shopGmvError 429, waiting 60s`); await sleep(60_000) }
    }
    if (o?.totalAffiliateGMV === undefined) throw new Error(`overview ${label}: totalAffiliateGMV missing`)
    return o
  })
}
const guard = (o: any) => ({ gmvFiltered: o?.gmvFiltered ?? null, filteredGmvUnavailable: o?.filteredGmvUnavailable ?? null, shopGmvError: o?.shopGmvError ?? null })
const shopOk = (o: any) => { const g = guard(o); return g.gmvFiltered === false && g.filteredGmvUnavailable === false && g.shopGmvError === null }

async function pullAll(w: Windows) {
  const [A, B] = w.cur, [PA, PB] = w.prior, [WA, WB] = w.week
  const ov = await overview('d30', A, B, true)
  const months = []
  for (const [lab, a, b] of w.months) months.push(await overview(`m_${a.slice(0, 7)}`, a, b, false))
  const ret = await step('retention', () => call('get_creator_retention_summary', { ...range(A, B), compareTo: { type: 'custom', startDate: PA, endDate: PB } }))
  const ads = await step('ads', () => call('get_dashboard_ads_overview', { postedDateRange: range(A, B), compareTo: { type: 'none' } }))
  const lv = {
    cur: await levels('d30', A, B), prior: await levels('prior', PA, PB),
    weeks: [] as number[][][], months: [] as number[][][],
  }
  for (const s of w.week_starts) { const [y, m, d] = s.split('-').map(Number); const e = new Date(Date.UTC(y, m - 1, d + 6)).toISOString().slice(0, 10); lv.weeks.push(await levels(`w_${s}`, s, e)) }
  for (const [, a, b] of w.months) lv.months.push(await levels(`m_${a.slice(0, 7)}`, a, b))
  const files = {
    videos: await exportVideos('videos', { kind: 'lifetime', sort: { field: 'postedAt', direction: 'desc' } }, 'lifetime'),
    cw_cur: await exportVideos('cw_30d', { kind: 'commerceWindow', dateRange: range(A, B) }, 'commerceWindow'),
    cw_prior: await exportVideos('cw_prior', { kind: 'commerceWindow', dateRange: range(PA, PB) }, 'commerceWindow'),
    cw_week: await exportVideos('cw_week', { kind: 'commerceWindow', dateRange: range(WA, WB) }, 'commerceWindow'),
    gmvmax_creatives: join(DIR, 'dl', 'gmvmax.csv'),
  }
  const gm = await step('export_gmvmax', async () => {
    const start = await call('export_gmv_max_report', { ...range(A, B), dataset: 'creatives' })
    if (!start?.taskId) throw new Error(`export_gmv_max_report: no taskId (${JSON.stringify(start).slice(0, 200)})`)
    await waitTask(start.taskId, 'gmvmax')
    const link = await call('get_gmv_max_export_download_url', { taskId: start.taskId })
    return download(String(link?.url ?? link?.downloadUrl), files.gmvmax_creatives, 'gmvmax')
  })
  if (!existsSync(gm.file)) { dropCache(s => s === 'export_gmvmax'); return pullAll(w) }
  const k = ads?.adKpis ?? {}
  const spend = Number(k.currentSpend), revenue = Number(k.currentRevenue)
  if (!Number.isFinite(spend) || !Number.isFinite(revenue)) throw new Error('ads overview: adKpis.currentSpend/currentRevenue missing')
  const rc = Number(ret?.current?.retentionRate), rp = Number(ret?.previous?.retentionRate)
  if (!Number.isFinite(rc) || !Number.isFinite(rp)) throw new Error('retention summary: current/previous retentionRate missing')
  return {
    levels: lv, files,
    overview: {
      shopGmv: Number(ov.totalShopGMV) || 0, shopGmvPct: Number(ov.totalShopGMVDifference) || 0,
      affiliateGmv: Number(ov.totalAffiliateGMV) || 0, affiliateGmvPct: Number(ov.totalAffiliateGMVDifference) || 0,
      guardrail: guard(ov),
      monthly_shop: months.map(o => (shopOk(o) ? r2(Number(o.totalShopGMV) || 0) : 0)),
      monthly_aff: months.map(o => r2(Number(o.totalAffiliateGMV) || 0)),
    },
    retention: { cur: rc * 100, prior: rp * 100 },
    gmvmax: { spend: r2(spend), revenue: r2(revenue) },
    warnings: months.map((o, i) => (shopOk(o) ? '' : `shop GMV for ${w.months[i][0]} withheld by the guardrail (${o?.shopGmvError ?? 'filtered'}), shown as 0`)).filter(Boolean),
  }
}

// ---------- agents (Phase 2 steps 7 and 8) ----------
async function pullAgents(w: Windows) {
  const raw: Array<{ a: any; type: 'outreach' | 'crm' }> = []
  for (const type of ['outreach', 'crm'] as const) {
    const pages = await step(`agents_list_${type}`, async () => {
      const out: any[] = []
      for (let page = 1; page <= 80; page++) {
        const r = await call('list_outreach_agents', { agentType: type, archived: false, limit: 25, page, searchQuery: '' })
        const rows: any[] = r?.agents ?? []
        out.push(...rows)
        if (!rows.length || out.length >= Number(r?.total ?? 0)) break
        if (rows.every(a => laDate(String(a.created_time)) < w.cur[0])) break
      }
      return out
    })
    for (const a of pages) raw.push({ a, type })
  }
  const kept = inWindow(raw, w.cur[0], w.cur[1])
  const gaps: string[] = []
  const rows = []
  for (const { a, type } of kept) {
    let e: Enrichment
    try { e = await step(`agent_${a.id}`, async () => enrich(await call('get_outreach_agent', { campaignId: Number(a.id) }))) }
    catch (err) { e = UNENRICHED; gaps.push(`${a.id} ${a.campaign_name}: ${(err as Error).message}`) }
    rows.push(agentRow(a, type, e))
  }
  const conv: Record<number, number> = {}
  for (const { a } of raw) conv[Number(a.id)] = Number(a.total_conversations ?? 0) || 0
  return { rows, gaps, conv, counts: { outreach_in_window: rows.filter(r => r.agent_type === 'outreach').length, crm_in_window: rows.filter(r => r.agent_type === 'crm').length } }
}

// ---------- re-engagement (spec v3.2, shared module) ----------
async function pullReengagement(w: Windows, conv: Record<number, number>) {
  const tags: ReTag[] = ((await step('re_tags', () => call('list_member_tags', { include: { memberCount: true } })))?.result ?? [])
    .map((t: any) => ({ id: t.id, name: t.name, memberCount: t.memberCount }))
  const rel = relevantTags(tags)
  const members: ReMember[] = !rel.length ? [] : await step('re_members', async () => {
    const out: ReMember[] = []
    for (let skip = 0; skip < 20000; skip += 100) {
      const r = await call('list_members', { filters: { tagFilter: { op: 'anyOf', ids: rel.map(t => t.id) } }, include: { creator: true, tiktokMetrics: true, tags: true }, take: 100, skip })
      const rows: any[] = r?.result ?? []
      for (const m of rows) {
        const tm = m.tiktokMetrics ?? {}, cr = m.creator ?? {}
        const lp = tm.lastVideoPostedDate ? laDate(String(tm.lastVideoPostedDate)) : null
        const g = tm.gmv30dNum ?? cr.gmv30d
        out.push({ id: m.id, handle: tm.handle ?? cr.handle ?? m.social?.tiktok ?? null, gmv30d: g == null ? null : Number(g), lastPosted: lp, tags: (m.tags ?? []).map((t: any) => t.name) })
      }
      if (rows.length < 100) break
    }
    return out
  })
  const weeks = [...new Set(rel.map(t => /^RE (\d{4}-W\d{2}) /.exec(t.name)?.[1]).filter(Boolean) as string[])]
  const lists: ReList[] = []
  for (const wk of weeks) {
    const r = await step(`re_lists_${wk}`, () => call('list_member_lists', { filters: { search: wk }, include: { linkedAgents: true }, take: 100 }))
    for (const l of r?.result ?? []) lists.push({ name: String(l.name), linkedAgentIds: (l.linkedAgents ?? []).map((a: any) => Number(a.id ?? a.campaignId ?? a.campaign_id)).filter(Number.isFinite) })
  }
  return computeReengagement({ asOf: w.report_date, tags, members, lists, agentConversations: conv })
}

// ---------- build (Phase 3) ----------
function py(script: string, args: string[]) {
  const r = spawnSync('python3', ['-I', join(process.cwd(), 'py', script), ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
function build(inputs: any) {
  const ip = join(DIR, 'inputs.json'), out = join(DIR, 'build')
  mkdirSync(out, { recursive: true }); writeFileSync(ip, JSON.stringify(inputs))
  const r = py('build_report.py', [ip, out])
  console.log(r.out)
  if (r.code !== 0) throw new Error(`build_report.py failed: ${r.out.slice(-1500)}`)
  return { draft: JSON.parse(readFileSync(join(out, 'draft.json'), 'utf8')), controls: JSON.parse(readFileSync(join(out, 'controls.json'), 'utf8')), log: r.out }
}
async function creatorInfo(handles: string[]) {
  const info: Record<string, { flw: number; eng: number | null; ggmv: number }> = {}, missing: string[] = []
  for (let i = 0; i < handles.length; i += 100) {
    const batch = handles.slice(i, i + 100)
    const r = await call('search_creators', { filters: { handles: batch }, includeMatchedVideos: false, pagination: { page: 1, pageSize: batch.length } })
    for (const c of r?.creators ?? []) {
      const h = String(c.handle).toLowerCase()
      const eng = c.avg_video_engagement_30d == null ? null : Number(c.avg_video_engagement_30d) / 100
      info[h] = { flw: Number(c.follower_count_num ?? 0) || 0, eng: eng != null && Number.isFinite(eng) ? Math.round(eng * 100) / 100 : null, ggmv: Number(c.gmv_30d_num ?? 0) || 0 }
    }
    missing.push(...(r?.meta?.missingHandles ?? []).map((h: string) => h.toLowerCase()))
  }
  for (const h of handles) if (!info[h] && !missing.includes(h)) missing.push(h)
  return { info, missing }
}
const tableHandles = (draft: any) => [...new Set(Object.values(draft.tables as Record<string, any[]>).flat().map((x: any) => String(x.h)))].sort()

// ---------- audit (Phase 6) ----------
const ALLOWED_WARN = [/partial-month retention/, /agents missing get_outreach_agent enrichment/]
function audit(report: any, controls: any) {
  const rp = join(DIR, `ruff-liners-weekly-report-${report.meta.reportDate}.json`), cp = join(DIR, 'controls.json')
  writeFileSync(rp, JSON.stringify(report)); writeFileSync(cp, JSON.stringify(controls, null, 1))
  const r = py('audit_report.py', [rp, cp])
  writeFileSync(join(DIR, 'audit.txt'), r.out)
  console.log(r.out)
  const failures = [...r.out.matchAll(/^\s*FAIL - (.+)$/gm)].map(m => m[1])
  const warnings = [...r.out.matchAll(/^\s*WARN - (.+)$/gm)].map(m => m[1])
  const disallowed = warnings.filter(x => !ALLOWED_WARN.some(re => re.test(x)))
  const pass = r.code === 0 && /AUDIT: PASS/.test(r.out) && !disallowed.length
  return { pass, failures: [...failures, ...disallowed.map(x => `WARN not allowed by the skill: ${x}`)], warnings: warnings.filter(x => !disallowed.includes(x)) }
}
/** Which cached pulls to drop for a failure line (re-pull the failing source once). */
function sourcesFor(line: string): (s: string) => boolean {
  if (/^agents|agent /.test(line)) return s => s.startsWith('agents_list') || s.startsWith('agent_')
  if (/^weekly/.test(line)) return s => s.startsWith('levels_w_') || s === 'export_videos'
  if (/^monthly/.test(line)) return s => s.startsWith('levels_m_') || s.startsWith('overview_m_') || s === 'export_videos'
  if (/gmvMax/.test(line)) return s => s === 'ads' || s === 'export_gmvmax'
  if (/^tables|activeCreators|topCreators/.test(line)) return s => s.startsWith('export_')
  if (/retention/.test(line)) return s => s === 'retention' || s === 'export_videos'
  return s => s.startsWith('levels_d30') || s.startsWith('levels_prior') || s.startsWith('overview_d30') || s.startsWith('export_cw')
}

// ---------- one full pass ----------
async function produce(w: Windows) {
  const pulls = await pullAll(w)
  setProgress({ currentStep: 'agents' })
  const ag = await pullAgents(w)
  const inputs: any = {
    report_date: w.report_date,
    windows: { cur: w.cur, prior: w.prior, week: w.week, week_starts: w.week_starts, months: w.months },
    levels: pulls.levels, overview: pulls.overview, retention: pulls.retention, gmvmax: pulls.gmvmax, files: pulls.files, creator_info: {},
  }
  setProgress({ currentStep: 'build' })
  let b = build(inputs)
  const ci = await step('creator_info', () => creatorInfo(tableHandles(b.draft)))
  inputs.creator_info = ci.info
  b = build(inputs)
  setProgress({ d30Gmv: b.draft.d30.gmv })

  const re = await step('reengagement', () => pullReengagement(w, ag.conv))
  const derived = deriveFacts(readFileSync(pulls.files.videos, 'utf8'), readFileSync(pulls.files.cw_cur, 'utf8'), w.cur[0], w.cur[1])

  const report: any = {
    meta: { ...b.draft.meta, weekWindow: { start: w.week[0], end: w.week[1] }, d30Window: { start: w.cur[0], end: w.cur[1] }, priorWindow: { start: w.prior[0], end: w.prior[1] }, timezone: 'America/Los_Angeles', promptVersion: 'pipeline-weekly-1', generatedAt: new Date().toISOString() },
    d30: b.draft.d30, weeklyCharts: b.draft.weeklyCharts, monthlyCharts: b.draft.monthlyCharts, tables: b.draft.tables,
    agents: ag.rows,
  }
  const controls = { ...b.controls, agents: ag.counts, derived_numbers: [...new Set([...numbersIn(derived), ...reengagementNumbers(re)].map(r2))] }
  setProgress({ currentStep: 'analysis' })
  const pool = [...numbersIn(report), ...numbersIn(controls)]
  const an = await step('analysis', () => writeAnalysis({ report, controls, derived, reengagement: re, pool }))
  report.analysis = an.analysis
  const notes = [
    ...pulls.warnings,
    ...(ci.missing.length ? [`creators Euka could not find (followers 0, engagement null): ${ci.missing.join(', ')}`] : []),
    ...(/capped newCreators[^\n]*none/.test(b.log) ? [] : [`newCreators capped at the level's dashboard creator count: ${(/capped newCreators[^\n]*/.exec(b.log) ?? [''])[0].replace(/^[^:]*:\s*/, '')}`]),
    ...((/GMV Max: [^\n]*/.exec(b.log) ?? []).map(x => x)),
    ...ag.gaps.map(g => `agent not enriched: ${g}`),
    ...(an.reprompted ? ['analysis was re-prompted once to remove untraced dollar figures or em dashes'] : []),
  ]
  return { report, controls, notes, audit: audit(report, controls) }
}

async function scorecardCheck(today: string, waitMinutes: number): Promise<'OK' | 'NOT PUBLISHED TODAY'> {
  const deadline = Date.now() + waitMinutes * 60_000
  for (;;) {
    const st = await readState().catch(e => { console.warn('scorecard state read failed:', (e as Error).message); return null })
    if (st?.latest?.as_of === today) return 'OK'
    if (Date.now() >= deadline) return 'NOT PUBLISHED TODAY'
    console.log(`scorecard for ${today} not published yet (latest ${st?.latest?.as_of ?? 'none'}); waiting 2 minutes`)
    await sleep(120_000)
  }
}

async function main() {
  const today = laToday()
  const reportDate = (process.env.REPORT_DATE || '').trim() || today
  const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null
  const dash = (process.env.DASHBOARD_URL || '').replace(/\/$/, '')
  setProgress({ reportDate, runUrl, dashboardUrl: dash ? `${dash}/dashboard/${reportDate}` : null, currentStep: 'windows' })
  validateReportDate(reportDate, today)
  const w = computeWindows(reportDate)
  DIR = join(ROOT, reportDate)
  mkdirSync(DIR, { recursive: true }); writeFileSync(join(DIR, 'windows.json'), JSON.stringify(w, null, 1))
  setProgress({ weekWindow: `${w.week[0]}..${w.week[1]}`, d30Window: `${w.cur[0]}..${w.cur[1]}` })

  setProgress({ currentStep: 'scorecard check' })
  // Checks once by default (the Monday run is at 7 AM Central, before the scorecard); SCORECARD_WAIT_MINUTES can add a wait
  const scorecard = await scorecardCheck(today, Number(process.env.SCORECARD_WAIT_MINUTES ?? 0))
  setProgress({ scorecard })

  setProgress({ currentStep: 'euka connect' })
  E = await Euka.connect().catch((e: Error) => {
    throw new Error(/401|invalid_token|authorization/i.test(e.message) ? `Euka rejected EUKA_BEARER_TOKEN (expired or not a long-lived token): ${e.message}` : e.message)
  })
  try {
    let run = await produce(w)
    if (!run.audit.pass) {
      console.error('Audit FAIL; re-pulling the failing source once:\n' + run.audit.failures.join('\n'))
      const preds = run.audit.failures.map(sourcesFor)
      dropCache(s => preds.some(p => p(s)) || s === 'analysis' || s === 'creator_info')
      run = await produce(w)
    }
    setProgress({ audit: run.audit.pass ? 'PASS' : 'FAIL', auditFailures: run.audit.failures, warnings: [...run.audit.warnings, ...run.notes] })
    if (!run.audit.pass) { setProgress({ currentStep: 'audit' }); throw new Error(`audit still FAIL after one re-pull: ${run.audit.failures.slice(0, 5).join('; ')}`) }

    setProgress({ currentStep: 'publish' })
    const res = await publishReport({ ...run.report, reportOnly: true, audit: { status: 'PASS', failures: [], warnings: run.audit.warnings } })
    const flags: string[] = Array.isArray(res?.needsReview) ? res.needsReview : []
    const outcome = flags.length ? 'PUBLISHED WITH REVIEW FLAGS' : 'PUBLISHED'
    setProgress({ reviewFlags: flags, outcome, finished: true, currentStep: 'notify' })
    if (process.env.SLACK_REPORT_POSTS === '1') {
      await slack(`:bar_chart: Weekly TikTok report ${outcome.toLowerCase()} for ${reportDate}: creator-video GMV $${run.report.d30.gmv.toLocaleString('en-US')} (${w.cur[0]} to ${w.cur[1]}). ${dash}/dashboard/${reportDate}`)
    }
  } finally { await E.close().catch(() => {}) }
}

main().catch((err: Error) => {
  console.error(err)
  setProgress({ outcome: 'FAILED', finished: true, failedStep: progress.currentStep ?? 'unknown', error: String(err?.message ?? err).slice(0, 800) })
}).finally(() => {
  const s: Status = finalStatus(progress, { reportDate: progress.reportDate, dashboardUrl: process.env.DASHBOARD_URL, runUrl: progress.runUrl ?? undefined })
  writeOutputs(s, '') // the workflow's always() status step writes the email outputs from the progress file
  if (s.outcome === 'FAILED') process.exitCode = 1
})
