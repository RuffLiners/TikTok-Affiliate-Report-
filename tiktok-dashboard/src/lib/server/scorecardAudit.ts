import { supabaseAdmin } from '@/lib/supabase'
import { LINES, LINE_KEYS, ManualEntry, Scorecard, ScorecardRaw, auditScorecard, buildScorecard, buildTodo, computeRoi } from '@/lib/scorecard'
import { ADS_HISTORY_FROM, RAW_VERSION, VIEWS_FROM, backfillWanted, ChatCache } from '@/lib/scorecard/engine'

/** Where each line comes from, in words a reviewer can check against Euka or Seller Center. */
const SOURCES: Record<string, { source: string; rawField: string; noData: string }> = {
  grossRevenue: { rawField: 'gmvMaxRevenue', source: 'Euka get_dashboard_ads_overview, dailyRoas[].revenue summed over the period (GMV Max attributed revenue, TikTok co-funded basis). Seller Center entry only where Euka has none.', noData: `No Euka data before ${ADS_HISTORY_FROM}.` },
  gmv: { rawField: 'shopGmv', source: 'Euka get_dashboard_performance_series, performances[].total_shop_gmv summed over the period. Seller Center entry only where Euka has none.', noData: 'TikTok keeps about 180 days of shop GMV; earlier periods are no data unless entered from Seller Center.' },
  gmvCofunded: { rawField: '(manual only)', source: 'Seller Center Shop analytics, "Gross merchandise value (with TikTok co-funding)". Entered by hand or CSV. Euka has no such field.', noData: 'No data until entered.' },
  gmvMaxSpend: { rawField: 'gmvMaxSpend', source: 'Euka get_dashboard_ads_overview, dailyRoas[].cost summed over the period.', noData: `No Euka data before ${ADS_HISTORY_FROM}.` },
  gmvMaxRoi: { rawField: '(derived)', source: 'Line 1 divided by line 4, recomputed, never averaged.', noData: 'No data when either side is missing or spend is 0.' },
  targetInvites: { rawField: 'targetInvites', source: 'Euka get_dashboard_performance_series, analyticsAggregated[].target_invites summed.', noData: 'A period with any missing day is no data, never a partial sum.' },
  eukaMessages: { rawField: 'eukaMessages', source: 'Messages the team sent in Euka Chat (Inbox channel CreatorAppChat, senderType Manager), counted by Los Angeles day. Not the automated outreach delivered as TikTok Shop DMs.', noData: 'No data before the first Euka Chat message; a real 0 after.' },
  emails: { rawField: 'emails', source: 'Euka get_dashboard_performance_series, analyticsAggregated[].emails_sent summed.', noData: 'A period with any missing day is no data.' },
  samplesApproved: { rawField: 'samplesApproved', source: 'Euka get_dashboard_performance_overview.samplesApproved for the exact period (requests created in the period that reached approval).', noData: 'A 0 in a range outside TikTok retention is stored as no data.' },
  creatorsPosted: { rawField: 'creatorsPosted', source: 'Euka get_dashboard_performance_overview.activeCreators for the exact period (distinct creators who posted). Never summed across periods.', noData: 'A 0 in a range outside TikTok retention is stored as no data.' },
  videos: { rawField: 'videos', source: 'Euka get_dashboard_performance_series, videoPosted[].videos_posted summed.', noData: 'A period with any missing day is no data.' },
  views: { rawField: 'views', source: 'Euka get_dashboard_performance_overview.allAccountVideoViews for the exact period.', noData: `Euka returns 0 before ${VIEWS_FROM}; stored as no data.` },
  contestAffiliates: { rawField: 'contestAffiliates', source: 'Euka list_contests + get_contest participants, distinct creators per calendar month the contest starts in. Retainers and cancelled contests excluded. A week shows the count for the month its last day falls in.', noData: 'No data before the first contest month.' },
  usageRightsCreators: { rawField: 'usageRightsCreators', source: 'Euka search_usage_rights_requests, state active, distinct creator ids. Current count for the newest period; older periods use the daily snapshot taken the day after they end.', noData: 'No data for periods before daily snapshots began.' },
}

const HOW_TO_AUDIT = [
  'This file is everything the scorecard tool has stored and published. Audit it; do not trust it.',
  '1. For 3 to 5 recent periods in "periods", call the Euka tool named in "lines[].source" with the period start and end dates (America/Los_Angeles) and compare with periods[].raw. Report every difference with both numbers.',
  '2. Recompute: gmvMaxRoi = raw.gmvMaxRevenue / raw.gmvMaxSpend (2 decimals). "integrityChecks" already lists what the tool found; confirm a sample by hand.',
  '3. Additive lines only (1, 2, 4, 6, 7, 8, 9, 11, 12): the weeks that fall wholly inside a month must not add up to more than that month. Lines 10, 13, 14 count distinct people and must never be summed.',
  '4. A null is "no data" and must never be read as 0. Check "storage.missingFromStore" and "storage.outdatedDefinition": both should be empty after a completed backfill.',
  '5. Values with source "manual" or "seller_center" were typed in or imported; check them against Seller Center, not Euka.',
  '6. Report: what matches, what differs (period, line, tool value, stored value), what could not be checked and why. Never correct a number yourself.',
]

export async function buildScorecardAudit() {
  const sb = supabaseAdmin()
  const [pub, per, man, cm, snaps, cfg] = await Promise.all([
    sb.from('scorecards').select('as_of, raw, audit, published_by, created_at').order('as_of', { ascending: false }).limit(1).maybeSingle(),
    sb.from('scorecard_periods').select('period_type, period_key, start_date, end_date, raw, raw_version, final, pulled_at').limit(2000),
    sb.from('scorecard_manual').select('*').limit(5000),
    sb.from('scorecard_contest_months').select('month, creator_count, final, pulled_at').order('month', { ascending: false }).limit(200),
    sb.from('scorecard_snapshots').select('snap_date, key, value').order('snap_date', { ascending: false }).limit(120),
    sb.from('app_config').select('key, value').in('key', ['scorecard_backfill_state', 'scorecard_eukachat_threads']),
  ])
  const firstErr = [pub, per, man, cm, snaps, cfg].find(r => r.error)?.error
  if (firstErr) throw new Error(firstErr.message)
  const manual = (man.data ?? []).map((r: any) => ({ ...r, value: Number(r.value) })) as ManualEntry[]
  const cfgVal = (k: string) => { try { return JSON.parse((cfg.data ?? []).find(r => r.key === k)?.value ?? 'null') } catch { return null } }
  const state = cfgVal('scorecard_backfill_state')
  const chat: ChatCache = cfgVal('scorecard_eukachat_threads') ?? {}
  const chatDaily: Record<string, number> = {}
  for (const t of Object.values(chat)) for (const [d, n] of Object.entries(t.days ?? {})) chatDaily[d] = (chatDaily[d] ?? 0) + n

  const raw = (pub.data?.raw ?? null) as ScorecardRaw | null
  const sc: Scorecard | null = raw ? buildScorecard(raw, manual) : null
  const stored = new Map((per.data ?? []).map(p => [`${p.period_type}:${p.period_key}`, p]))
  const view = (type: 'week' | 'month', p: { key: string; start: string; end: string; lines: Scorecard['weekly'][number]['lines']; gmvMaxRevenue: number | null }, extra: Record<string, unknown> = {}) => {
    const s = stored.get(`${type}:${p.key}`)
    return {
      type, key: p.key, start: p.start, end: p.end, ...extra,
      stored: s ? { final: s.final, rawVersion: s.raw_version, pulledAt: s.pulled_at, endDate: s.end_date } : null,
      raw: (type === 'week' ? raw!.weeks : raw!.months)[p.key] ?? null,
      lines: Object.fromEntries(LINE_KEYS.map(k => [k, { value: p.lines[k].value, source: p.lines[k].source, ...(p.lines[k].enteredBy ? { enteredBy: p.lines[k].enteredBy } : {}) }])),
    }
  }
  const months = sc ? sc.monthly.map(m => view('month', m, { partial: m.partial, daysElapsed: m.daysElapsed, daysInMonth: m.daysInMonth, ...(m.partial ? { monthEndEstimate: m.projected } : {}) })) : []
  const weeks = sc ? (sc.weeklyAll ?? sc.weekly).map(w => view('week', w)) : []

  // Integrity checks the tool can do without calling Euka
  const checks: Array<{ check: string; ok: boolean; detail?: string }> = []
  if (sc && raw) {
    const a = auditScorecard(sc)
    checks.push({ check: 'scorecard rules (TypeScript audit)', ok: a.status === 'PASS', detail: a.failures.slice(0, 20).join(' | ') || undefined })
    const roiBad = [...weeks, ...months].filter(p => { const r = p.raw as any; const exp = computeRoi(p.lines.grossRevenue.value, r?.gmvMaxSpend); return (exp ?? null) !== (p.lines.gmvMaxRoi.value ?? null) })
    checks.push({ check: 'ROI equals Gross Revenue / GMV Max spend in every period', ok: roiBad.length === 0, detail: roiBad.map(p => `${p.type} ${p.key}`).join(', ') || undefined })
    const over: string[] = []
    for (const m of months) {
      const inside = weeks.filter(w => w.start >= m.start && w.end <= m.end)
      for (const f of ['shopGmv', 'gmvMaxSpend', 'gmvMaxRevenue', 'videos', 'targetInvites', 'emails', 'eukaMessages'] as const) {
        const mv = (m.raw as any)?.[f]; const vals = inside.map(w => (w.raw as any)?.[f])
        if (mv == null || vals.some(v => v == null) || !vals.length) continue
        const sum = vals.reduce((t: number, v: number) => t + v, 0)
        if (sum > mv + 0.05) over.push(`${m.key} ${f}: weeks inside the month sum to ${Math.round(sum * 100) / 100}, month is ${mv}`)
      }
    }
    checks.push({ check: 'weeks wholly inside a month never add up to more than the month', ok: over.length === 0, detail: over.slice(0, 20).join(' | ') || undefined })
    const zeros = [...weeks, ...months].flatMap(p => (['shopGmv', 'gmvMaxSpend', 'gmvMaxRevenue', 'videos', 'views'] as const).filter(f => (p.raw as any)?.[f] === 0).map(f => `${p.type} ${p.key} ${f}`))
    checks.push({ check: 'no stored 0 on lines where 0 would be suspicious (GMV, spend, revenue, videos, views)', ok: zeros.length === 0, detail: zeros.slice(0, 30).join(', ') || undefined })
  }
  const wanted = raw ? backfillWanted(raw.asOf, raw.dataThrough, '2025-10-01') : []
  const missingFromStore = wanted.filter(w => !stored.has(`${w.type}:${w.key}`)).map(w => `${w.type} ${w.key}`)
  const outdated = [...stored.values()].filter(p => p.raw_version !== RAW_VERSION).map(p => `${p.period_type} ${p.period_key} (v${p.raw_version})`)

  return {
    file: 'Ruff Liners TikTok scorecard audit export',
    generatedAt: new Date().toISOString(),
    howToAudit: HOW_TO_AUDIT,
    brandId: 'b4ec897a-fb59-48e7-9320-873ea5e25155',
    timeZone: 'America/Los_Angeles',
    published: pub.data ? { asOf: pub.data.as_of, dataThrough: raw?.dataThrough ?? null, publishedAt: pub.data.created_at, publishedBy: pub.data.published_by, audit: pub.data.audit } : null,
    lines: LINES.map(l => ({ n: l.n, key: l.key, label: l.label, kind: l.kind, distinctPeople: !!l.distinct, ...SOURCES[l.key] })),
    rules: { weeks: 'Sunday to Saturday', monthFinal: 'a finished month is final 3 days after it ends', currentRawVersion: RAW_VERSION, nullMeans: 'no data, never 0' },
    integrityChecks: checks,
    storage: { periodsStored: stored.size, periodsExpected: wanted.length, missingFromStore, outdatedDefinition: outdated },
    allTime: sc ? Object.fromEntries(LINE_KEYS.map(k => [k, { value: sc.allTime.lines[k].value, source: sc.allTime.lines[k].source, note: sc.allTime.lines[k].note }])) : null,
    months, weeks,
    manualEntries: manual,
    stillToEnter: sc ? buildTodo(sc) : null,
    issues: sc?.issues ?? [],
    inputs: {
      contestMonths: cm.data ?? [],
      usageRightsSnapshots: (snaps.data ?? []).map(r => ({ date: r.snap_date, key: r.key, value: Number(r.value) })),
      eukaChat: { conversations: Object.keys(chat).length, firstDay: Object.keys(chatDaily).sort()[0] ?? null, teamMessagesByDay: Object.fromEntries(Object.entries(chatDaily).sort()) },
    },
    lastRun: state ? {
      runId: state.runId, status: state.status, mode: state.mode, scope: state.scope ?? 'full', trigger: state.trigger ?? 'manual', asOf: state.asOf, startedAt: state.startedAt, lastProgress: state.updatedAt, finishedAt: state.finishedAt ?? null,
      lastError: state.lastError ?? null, alerts: state.alerts ?? [],
      periods: (state.periods ?? []).map((p: any) => ({ id: p.id, status: p.status, ...(p.reason ? { reason: p.reason } : {}), ...(p.controlDiffs ? { controlDiffs: p.controlDiffs } : {}) })),
    } : null,
  }
}
