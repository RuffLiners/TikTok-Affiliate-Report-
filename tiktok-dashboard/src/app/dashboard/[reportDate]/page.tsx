import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabase'
import { WeeklyReport } from '@/lib/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { KpiCard } from '@/components/KpiCard'
import { D30Content } from '@/components/D30Content'
import { WeeklyCharts } from '@/components/charts/WeeklyCharts'
import { MonthlyCharts } from '@/components/charts/MonthlyCharts'
import { WeeklyCreatorTable } from '@/components/tables/WeeklyCreatorTable'
import { VideoTable } from '@/components/tables/VideoTable'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { AnalysisCard } from '@/components/AnalysisCard'

export const revalidate = 3600

interface Props { params: Promise<{ reportDate: string }> }

function calcTrend(arr: number[]): 'up' | 'down' | 'flat' {
  if (arr.length < 4) return 'flat'
  const s = arr.slice(-4)
  const a = (s[0] + s[1]) / 2
  const b = (s[2] + s[3]) / 2
  return b > a * 1.05 ? 'up' : b < a * 0.95 ? 'down' : 'flat'
}

function getMonthProgress(reportDate: string) {
  const d = new Date(reportDate + 'T00:00:00')
  const dayOfMonth = d.getDate()
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return { dayOfMonth, daysInMonth, pct: dayOfMonth / daysInMonth }
}

type TrendDir = 'up' | 'down' | 'flat' | null
type FmtType = 'currency' | 'number' | 'x'

function TargetRow({ label, actual, target, fmt = 'number', trend = null, note = '', higherIsBetter = true }: {
  label: string; actual: number; target: number
  fmt?: FmtType; trend?: TrendDir; note?: string; higherIsBetter?: boolean
}) {
  const ratio = target > 0 ? actual / target : 0
  const pctBar = Math.min(ratio * 100, 100)
  const status = higherIsBetter
    ? (ratio >= 0.9 ? 'on' : ratio >= 0.7 ? 'risk' : 'off')
    : (ratio <= 1.1 ? 'on' : ratio <= 1.3 ? 'risk' : 'off')
  const fv = (n: number) => fmt === 'currency' ? '$' + Math.round(n).toLocaleString('en-US')
    : fmt === 'x' ? n.toFixed(1) + '×'
    : Math.round(n).toLocaleString('en-US')
  const badge = status === 'on' ? 'text-green-700 bg-green-50' : status === 'risk' ? 'text-amber-700 bg-amber-50' : 'text-red-700 bg-red-50'
  const bar   = status === 'on' ? 'bg-green-500' : status === 'risk' ? 'bg-amber-400' : 'bg-red-400'
  const statusText = status === 'on' ? 'On Track' : status === 'risk' ? 'At Risk' : 'Off Track'
  return (
    <div className="py-3 border-b border-gray-50 last:border-0 last:pb-0 first:pt-0">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm text-gray-700 truncate">{label}</span>
          {trend === 'up'   && <span className="text-xs text-green-500 font-bold flex-shrink-0">↑</span>}
          {trend === 'down' && <span className="text-xs text-red-400  font-bold flex-shrink-0">↓</span>}
          {trend === 'flat' && <span className="text-xs text-gray-400 flex-shrink-0">→</span>}
          {note && <span className="text-xs text-gray-400 flex-shrink-0 hidden sm:inline">· {note}</span>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          <span className="text-sm font-semibold text-gray-900">{fv(actual)}</span>
          <span className="text-xs text-gray-400">/ {fv(target)}</span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge}`}>{statusText}</span>
        </div>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pctBar}%` }} />
      </div>
    </div>
  )
}

function MonthlyTargetRow({ label, mtd, target, projected, fmt = 'number', trend = null, monthPct }: {
  label: string; mtd: number; target: number; projected: number
  fmt?: FmtType; trend?: TrendDir; monthPct: number
}) {
  const mtdRatio  = target > 0 ? mtd       / target : 0
  const projRatio = target > 0 ? projected / target : 0
  const status = projRatio >= 0.9 ? 'on' : projRatio >= 0.7 ? 'risk' : 'off'
  const fv = (n: number) => fmt === 'currency' ? '$' + Math.round(n).toLocaleString('en-US')
    : fmt === 'x' ? n.toFixed(1) + '×'
    : Math.round(n).toLocaleString('en-US')
  const badge    = status === 'on' ? 'text-green-700 bg-green-50' : status === 'risk' ? 'text-amber-700 bg-amber-50' : 'text-red-700 bg-red-50'
  const barSolid = status === 'on' ? 'bg-green-500'  : status === 'risk' ? 'bg-amber-400' : 'bg-red-400'
  const barLight = status === 'on' ? 'bg-green-200'  : status === 'risk' ? 'bg-amber-200' : 'bg-red-200'
  const statusText = status === 'on' ? 'On Track' : status === 'risk' ? 'At Risk' : 'Off Track'
  return (
    <div className="py-3 border-b border-gray-50 last:border-0 last:pb-0 first:pt-0">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm text-gray-700 truncate">{label}</span>
          {trend === 'up'   && <span className="text-xs text-green-500 font-bold flex-shrink-0">↑</span>}
          {trend === 'down' && <span className="text-xs text-red-400  font-bold flex-shrink-0">↓</span>}
          {trend === 'flat' && <span className="text-xs text-gray-400 flex-shrink-0">→</span>}
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge}`}>{statusText}</span>
      </div>
      <div className="flex items-baseline justify-between mb-1.5 text-xs">
        <span className="text-gray-500">MTD: <span className="font-semibold text-gray-800">{fv(mtd)}</span></span>
        <span className="text-gray-500">Proj: <span className="font-semibold text-gray-800">{fv(projected)}</span></span>
        <span className="text-gray-400">Target: {fv(target)}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden relative">
        <div className={`absolute inset-y-0 left-0 rounded-full ${barLight}`} style={{ width: `${Math.min(projRatio * 100, 100)}%` }} />
        <div className={`absolute inset-y-0 left-0 rounded-full ${barSolid}`} style={{ width: `${Math.min(mtdRatio  * 100, 100)}%` }} />
      </div>
      <p className="mt-1 text-xs text-gray-400">{Math.round(monthPct * 100)}% through month</p>
    </div>
  )
}

export default async function ReportPage({ params }: Props) {
  const { reportDate } = await params

  const { data, error } = await supabase
    .from('weekly_reports')
    .select('*')
    .eq('report_date', reportDate)
    .single()

  if (error || !data) notFound()
  const report = data as WeeklyReport
  const d = report.d30

  // Fetch goals from app_config
  const adminSupabase = supabaseAdmin()
  const { data: goalsConfig } = await adminSupabase
    .from('app_config').select('value').eq('key', 'goals').single()
  const goals = goalsConfig ? (() => { try { return JSON.parse(goalsConfig.value) } catch { return null } })() : null

  // Compute last-week and current-month stats
  const wc = report.weekly_charts
  const lastWeekGmv   = wc.gmv.at(-1) ?? 0
  const lastWeekVid   = wc.vid.at(-1) ?? 0
  const lastWeekVidG1 = (wc.vl1?.at(-1) ?? wc.vg1?.at(-1) ?? 0)
  const lastWeekVidG2 = (wc.vl2?.at(-1) ?? wc.vg2?.at(-1) ?? 0)
  const lastWeekVidG3 = (wc.vl3?.at(-1) ?? wc.vg3?.at(-1) ?? 0)
  const lastWeekLabel = wc.labels.at(-1) ?? ''
  const mc = report.monthly_charts
  const currentMonthGmv   = mc.gmv.at(-1) ?? 0
  const currentMonthLabel = (mc.labels.at(-1) ?? '').replace('*', '').trim()
  const qtdGmv = mc.gmv.slice(-3).reduce((a: number, b: number) => a + b, 0)

  // Month-to-date + projected values from monthly_charts last entry
  // Use total account GMV (includes product cards + in-house) for targets; fall back to affiliate GMV for older reports
  const { pct: monthPct } = getMonthProgress(reportDate)
  const mtdGmv    = (mc.totalGmv?.at(-1) || 0) > 0 ? (mc.totalGmv!.at(-1)!) : (mc.gmv.at(-1) ?? 0)
  const mtdAffiliateGmv = mc.gmv.at(-1) ?? 0
  const qtdTotalGmv = mc.totalGmv && mc.totalGmv.some((v: number) => v > 0)
    ? mc.totalGmv.slice(-3).reduce((a: number, b: number) => a + b, 0)
    : qtdGmv
  const mtdVidG1  = (mc.vl1?.at(-1) ?? mc.vg1?.at(-1) ?? 0)
  const mtdVidG2  = (mc.vl2?.at(-1) ?? mc.vg2?.at(-1) ?? 0)
  const mtdVidG3  = (mc.vl3?.at(-1) ?? mc.vg3?.at(-1) ?? 0)
  const mtdVidG4  = mc.vl4?.at(-1) ?? 0
  const mtdVidG5  = mc.vl5?.at(-1) ?? 0
  const mtdVidG6  = mc.vl6?.at(-1) ?? 0
  const mtdVidG7  = mc.vl7?.at(-1) ?? 0
  const mtdVideos = mtdVidG1 + mtdVidG2 + mtdVidG3 + mtdVidG4 + mtdVidG5 + mtdVidG6 + mtdVidG7
  const sl = (k: string) => (mc as any)[k]?.at(-1) ?? 0
  const mtdSamplesShipped  = sl('sl1') + sl('sl2') + sl('sl3') + sl('sl4') + sl('sl5') + sl('sl6') + sl('sl7')
    || (mc as any).sg1?.at(-1) ?? 0 + ((mc as any).sg2?.at(-1) ?? 0) + ((mc as any).sg3?.at(-1) ?? 0)
  const salSum = sl('sal1') + sl('sal2') + sl('sal3') + sl('sal4') + sl('sal5') + sl('sal6') + sl('sal7')
  const mtdSamplesApproved = salSum > 0 ? salSum : mtdSamplesShipped
  const mtdSamples = mtdSamplesApproved
  const safe = (v: number) => monthPct > 0 ? v / monthPct : v
  const projGmv     = safe(mtdGmv)
  const projVideos  = safe(mtdVideos)
  const projVidG1   = safe(mtdVidG1)
  const projVidG2   = safe(mtdVidG2)
  const projVidG3   = safe(mtdVidG3)
  const projVidG4   = safe(mtdVidG4)
  const projVidG5   = safe(mtdVidG5)
  const projVidG6   = safe(mtdVidG6)
  const projVidG7   = safe(mtdVidG7)
  const projSamples = safe(mtdSamples)

  // Trends from last 4 weeks
  const gmvTrend = calcTrend(wc.gmv)
  const vidTrend = calcTrend(wc.vid)
  const wsl = (k: string) => (wc as any)[k] ?? []
  const weeklyTotalSamples = (wsl('sal1').length ? wsl('sal1') : wsl('sl1')).map((v: number, i: number) =>
    v + (wsl('sal2')[i] ?? wsl('sl2')[i] ?? 0)
      + (wsl('sal3')[i] ?? wsl('sl3')[i] ?? 0)
      + (wsl('sal4')[i] ?? wsl('sl4')[i] ?? 0)
      + (wsl('sal5')[i] ?? wsl('sl5')[i] ?? 0)
      + (wsl('sal6')[i] ?? wsl('sl6')[i] ?? 0)
      + (wsl('sal7')[i] ?? wsl('sl7')[i] ?? 0)
  )
  const sampTrend = calcTrend(weeklyTotalSamples)

  // 30d totals used as monthly proxies
  const d30TotalSamples = d.samples

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-gray-400 hover:text-gray-600 transition-colors">
              <ChevronLeft size={18} />
            </Link>
            <div>
              <h1 className="text-base font-semibold text-gray-900">{report.label}</h1>
              <p className="text-xs text-gray-400">{report.data_window}</p>
            </div>
          </div>
          <span className="text-xs bg-gray-50 text-gray-500 border border-gray-100 px-3 py-1 rounded-full">
            Ruff Liners · TikTok Shop
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        <Tabs defaultValue="30d">
          <TabsList className="mb-6">
            <TabsTrigger value="30d">Last 30 Days</TabsTrigger>
            <TabsTrigger value="weekly">Weekly · 13 wks</TabsTrigger>
            <TabsTrigger value="monthly">Monthly · 6 mo</TabsTrigger>
            <TabsTrigger value="insights">Insights</TabsTrigger>
          </TabsList>

          {/* ── 30 DAY TAB ── */}
          <TabsContent value="30d">
            <D30Content report={report} />
          </TabsContent>

          {/* ── WEEKLY TAB ── */}
          <TabsContent value="weekly" className="space-y-6">
            <AnalysisCard text={report.analysis?.weekly ?? ''} title="Weekly Trend Analysis" />
            <WeeklyCharts data={report.weekly_charts} />

            {report.tables.weeklyTopCreators && report.tables.weeklyTopCreators.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Top Creators · This Week · by GMV
                </h2>
                <WeeklyCreatorTable creators={report.tables.weeklyTopCreators} highlight="gmv" />
              </section>
            )}

            {report.tables.weeklyTopVideos && report.tables.weeklyTopVideos.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Top Videos · Posted This Week
                </h2>
                <VideoTable videos={report.tables.weeklyTopVideos} reportDate={reportDate} />
              </section>
            )}

            {report.tables.weeklyActiveCreators && report.tables.weeklyActiveCreators.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Most Active Creators · This Week · by Videos Posted
                </h2>
                <WeeklyCreatorTable creators={report.tables.weeklyActiveCreators} highlight="vid" />
              </section>
            )}
          </TabsContent>

          {/* ── MONTHLY TAB ── */}
          <TabsContent value="monthly">
            <AnalysisCard text={report.analysis?.monthly ?? ''} title="Monthly Analysis" />
            <MonthlyCharts data={report.monthly_charts} />
          </TabsContent>

          {/* ── INSIGHTS TAB ── */}
          <TabsContent value="insights" className="space-y-6">
            {/* Last week snapshot */}
            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Last Week · week of {lastWeekLabel}
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <KpiCard label="Affiliate GMV" value={lastWeekGmv} format="currency" />
                <KpiCard label="Videos Posted" value={lastWeekVid} format="number" />
              </div>
            </section>

            {/* Target Tracker */}
            {goals && (
              <section>
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Target Tracker</h2>
                <div className="space-y-4">

                  {/* Revenue — GMV */}
                  {(goals.monthlyGmvTarget || goals.quarterlyGmvTarget) && (
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Revenue — Total GMV</p>
                      {goals.monthlyGmvTarget && (
                        <MonthlyTargetRow
                          label={`Monthly · ${goals.monthlyPeriod ?? currentMonthLabel}`}
                          mtd={mtdGmv} projected={projGmv} target={goals.monthlyGmvTarget}
                          fmt="currency" trend={gmvTrend} monthPct={monthPct}
                        />
                      )}
                      {mtdAffiliateGmv > 0 && mtdAffiliateGmv !== mtdGmv && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          Affiliate GMV: <span className="font-medium text-gray-600">${Math.round(mtdAffiliateGmv).toLocaleString('en-US')}</span> MTD
                        </p>
                      )}
                      {goals.quarterlyGmvTarget && (
                        <TargetRow
                          label={`Quarterly · ${goals.quarterlyPeriod ?? 'Current Quarter'}`}
                          actual={qtdTotalGmv} target={goals.quarterlyGmvTarget}
                          fmt="currency" note="last 3 months"
                        />
                      )}
                    </div>
                  )}

                  {/* Videos per month */}
                  {(goals.monthlyVideosTarget || goals.monthlyVideosL1Target || goals.monthlyVideosL2Target || goals.monthlyVideosL3Target || goals.monthlyVideosL4Target || goals.monthlyVideosL5Target || goals.monthlyVideosL6Target || goals.monthlyVideosL7Target) && (
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                        Videos · {goals.monthlyVideosPeriod ?? currentMonthLabel}
                      </p>
                      {goals.monthlyVideosTarget && (
                        <MonthlyTargetRow label="Total" mtd={mtdVideos} projected={projVideos} target={goals.monthlyVideosTarget} trend={vidTrend} monthPct={monthPct} />
                      )}
                      {goals.monthlyVideosL1Target && (
                        <MonthlyTargetRow label="L1" mtd={mtdVidG1} projected={projVidG1} target={goals.monthlyVideosL1Target} monthPct={monthPct} />
                      )}
                      {goals.monthlyVideosL2Target && (
                        <MonthlyTargetRow label="L2" mtd={mtdVidG2} projected={projVidG2} target={goals.monthlyVideosL2Target} monthPct={monthPct} />
                      )}
                      {goals.monthlyVideosL3Target && (
                        <MonthlyTargetRow label="L3" mtd={mtdVidG3} projected={projVidG3} target={goals.monthlyVideosL3Target} monthPct={monthPct} />
                      )}
                      {goals.monthlyVideosL4Target && (
                        <MonthlyTargetRow label="L4" mtd={mtdVidG4} projected={projVidG4} target={goals.monthlyVideosL4Target} monthPct={monthPct} />
                      )}
                      {goals.monthlyVideosL5Target && (
                        <MonthlyTargetRow label="L5" mtd={mtdVidG5} projected={projVidG5} target={goals.monthlyVideosL5Target} monthPct={monthPct} />
                      )}
                      {goals.monthlyVideosL6Target && (
                        <MonthlyTargetRow label="L6" mtd={mtdVidG6} projected={projVidG6} target={goals.monthlyVideosL6Target} monthPct={monthPct} />
                      )}
                      {goals.monthlyVideosL7Target && (
                        <MonthlyTargetRow label="L7" mtd={mtdVidG7} projected={projVidG7} target={goals.monthlyVideosL7Target} monthPct={monthPct} />
                      )}
                    </div>
                  )}

                  {/* Samples per month */}
                  {goals.monthlySamplesTarget && (
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                        Samples · {goals.monthlySamplesPeriod ?? currentMonthLabel}
                      </p>
                      <MonthlyTargetRow label="Samples Approved" mtd={mtdSamples} projected={projSamples} target={goals.monthlySamplesTarget} trend={sampTrend} monthPct={monthPct} />
                    </div>
                  )}

                  {/* GMV Max Spend */}
                  {(goals.monthlyGmvMaxSpendTarget || goals.quarterlyGmvMaxSpendTarget) && (
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">GMV Max — Spend</p>
                      {goals.monthlyGmvMaxSpendTarget && (
                        <MonthlyTargetRow
                          label={`Monthly · ${goals.monthlyGmvMaxSpendPeriod ?? currentMonthLabel}`}
                          mtd={d.gmvMax.spend}
                          projected={monthPct > 0 ? d.gmvMax.spend / monthPct : d.gmvMax.spend}
                          target={goals.monthlyGmvMaxSpendTarget}
                          fmt="currency" monthPct={monthPct}
                        />
                      )}
                      {goals.quarterlyGmvMaxSpendTarget && (
                        <TargetRow
                          label={`Quarterly · ${goals.quarterlyGmvMaxSpendPeriod ?? 'Current Quarter'}`}
                          actual={d.gmvMax.spend * 3} target={goals.quarterlyGmvMaxSpendTarget}
                          fmt="currency" note="30d × 3 est."
                        />
                      )}
                    </div>
                  )}

                  {/* GMV Max ROI */}
                  {(goals.monthlyGmvMaxRoiTarget || goals.quarterlyGmvMaxRoiTarget) && (
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">GMV Max — ROI</p>
                      {goals.monthlyGmvMaxRoiTarget && (
                        <TargetRow
                          label={`Monthly · ${goals.monthlyGmvMaxRoiPeriod ?? currentMonthLabel}`}
                          actual={d.gmvMax.roi} target={goals.monthlyGmvMaxRoiTarget}
                          fmt="x"
                        />
                      )}
                      {goals.quarterlyGmvMaxRoiTarget && (
                        <TargetRow
                          label={`Quarterly · ${goals.quarterlyGmvMaxRoiPeriod ?? 'Current Quarter'}`}
                          actual={d.gmvMax.roi} target={goals.quarterlyGmvMaxRoiTarget}
                          fmt="x"
                        />
                      )}
                    </div>
                  )}

                  {/* Active Creators */}
                  {(goals.activeL1Target || goals.activeL2Target || goals.activeL3Target || goals.activeL4Target || goals.activeL5Target || goals.activeL6Target || goals.activeL7Target) && (
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Active Creators · 30-Day</p>
                      {goals.activeL1Target && (
                        <TargetRow label="L1" actual={d.tiers.l1?.creators ?? 0} target={goals.activeL1Target} />
                      )}
                      {goals.activeL2Target && (
                        <TargetRow label="L2" actual={d.tiers.l2?.creators ?? 0} target={goals.activeL2Target} />
                      )}
                      {goals.activeL3Target && (
                        <TargetRow label="L3" actual={d.tiers.l3?.creators ?? 0} target={goals.activeL3Target} />
                      )}
                      {goals.activeL4Target && (
                        <TargetRow label="L4" actual={d.tiers.l4?.creators ?? 0} target={goals.activeL4Target} />
                      )}
                      {goals.activeL5Target && (
                        <TargetRow label="L5" actual={d.tiers.l5?.creators ?? 0} target={goals.activeL5Target} />
                      )}
                      {goals.activeL6Target && (
                        <TargetRow label="L6" actual={d.tiers.l6?.creators ?? 0} target={goals.activeL6Target} />
                      )}
                      {goals.activeL7Target && (
                        <TargetRow label="L7" actual={d.tiers.l7?.creators ?? 0} target={goals.activeL7Target} />
                      )}
                    </div>
                  )}

                </div>
              </section>
            )}

            {/* New analysis format */}
            <AnalysisCard text={report.analysis?.performance ?? ''} title="Performance" variant="green" />
            <AnalysisCard text={report.analysis?.creators ?? ''} title="Creator & Content Highlights" variant="purple" />
            <AnalysisCard text={report.analysis?.recruiting ?? ''} title="Recruiting Priorities" variant="orange" />
            <AnalysisCard text={report.analysis?.growth ?? ''} title="Growth Opportunities" variant="blue" />

            {/* Fallback: show legacy analysis if no new-format content */}
            {!report.analysis?.performance && !report.analysis?.creators && !report.analysis?.recruiting && !report.analysis?.growth && (
              <div className="space-y-4">
                <AnalysisCard text={report.analysis?.d30 ?? ''} title="30-Day Analysis" />
                <AnalysisCard text={report.analysis?.weekly ?? ''} title="Weekly Trend Analysis" />
                <AnalysisCard text={report.analysis?.monthly ?? ''} title="Monthly Analysis" />
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
