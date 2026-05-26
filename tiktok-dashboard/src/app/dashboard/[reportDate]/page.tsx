import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabase'
import { WeeklyReport } from '@/lib/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { KpiCard } from '@/components/KpiCard'
import { TierCard } from '@/components/TierCard'
import { RecruitingCard } from '@/components/RecruitingCard'
import { CreatorTable } from '@/components/tables/CreatorTable'
import { VideoTable } from '@/components/tables/VideoTable'
import { ActiveCreatorTable } from '@/components/tables/ActiveCreatorTable'
import { WeeklyCharts } from '@/components/charts/WeeklyCharts'
import { MonthlyCharts } from '@/components/charts/MonthlyCharts'
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
  const lastWeekVidG1 = wc.vg1.at(-1) ?? 0
  const lastWeekVidG2 = wc.vg2.at(-1) ?? 0
  const lastWeekVidG3 = wc.vg3.at(-1) ?? 0
  const lastWeekLabel = wc.labels.at(-1) ?? ''
  const mc = report.monthly_charts
  const currentMonthGmv   = mc.gmv.at(-1) ?? 0
  const currentMonthLabel = (mc.labels.at(-1) ?? '').replace('*', '').trim()
  const qtdGmv = mc.gmv.slice(-3).reduce((a: number, b: number) => a + b, 0)

  // Month-to-date + projected values from monthly_charts last entry
  const { pct: monthPct } = getMonthProgress(reportDate)
  const mtdGmv    = mc.gmv.at(-1) ?? 0
  const mtdVidG1  = mc.vg1.at(-1) ?? 0
  const mtdVidG2  = mc.vg2.at(-1) ?? 0
  const mtdVidG3  = mc.vg3.at(-1) ?? 0
  const mtdVideos = mtdVidG1 + mtdVidG2 + mtdVidG3
  const mtdSamples = (mc.sg1.at(-1) ?? 0) + (mc.sg2.at(-1) ?? 0) + (mc.sg3.at(-1) ?? 0)
  const safe = (v: number) => monthPct > 0 ? v / monthPct : v
  const projGmv     = safe(mtdGmv)
  const projVideos  = safe(mtdVideos)
  const projVidG1   = safe(mtdVidG1)
  const projVidG2   = safe(mtdVidG2)
  const projVidG3   = safe(mtdVidG3)
  const projSamples = safe(mtdSamples)

  // Trends from last 4 weeks
  const gmvTrend = calcTrend(wc.gmv)
  const vidTrend = calcTrend(wc.vid)
  const weeklyTotalSamples = wc.sg1.map((v: number, i: number) => v + (wc.sg2[i] ?? 0) + (wc.sg3[i] ?? 0))
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
          <TabsContent value="30d" className="space-y-6">
            <AnalysisCard text={report.analysis?.d30 ?? ''} title="30-Day Analysis" />
            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Overview</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard label="Total GMV" value={d.gmv} format="currency" pct={d.gmvPct} />
                <KpiCard label="Orders" value={d.orders} format="number" pct={d.ordersPct} />
                <KpiCard label="Videos Posted" value={d.videos} format="number" pct={d.videosPct} />
                <KpiCard label="Total Views" value={d.views} format="compact" pct={d.viewsPct} />
              </div>
            </section>

            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Creator KPIs</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <KpiCard label="Creators Posted" value={d.creators} format="number" pct={d.creatorsPct} />
                <KpiCard label="New Creators" value={d.newCreators} format="number" pct={d.newCreatorsPct} />
                <KpiCard label="Retention Rate" value={d.retention} format="percent" delta={d.retentionDelta} deltaSuffix="pp" />
              </div>
            </section>

            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">By Creator Tier</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <TierCard tier="g1" label="Group 1 · <$25K" data={d.tiers.g1} color="blue" />
                <TierCard tier="g2" label="Group 2 · $25K–$100K" data={d.tiers.g2} color="green" />
                <TierCard tier="g3" label="Group 3 · >$100K" data={d.tiers.g3} color="amber" />
              </div>
            </section>

            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">GMV Max</h2>
              <div className="grid grid-cols-3 gap-3">
                <KpiCard label="Ad Spend" value={d.gmvMax.spend} format="currency" />
                <KpiCard label="Ad Revenue" value={d.gmvMax.revenue} format="currency" />
                <KpiCard label="ROI" value={d.gmvMax.roi} format="roi" />
              </div>
            </section>

            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Recruiting</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <RecruitingCard
                  label="Messages Sent" total={d.msgs} pct={d.msgsPct}
                  g1={d.tiers.g1.msgs} g1pct={d.tiers.g1.msgsPct}
                  g2={d.tiers.g2.msgs} g2pct={d.tiers.g2.msgsPct}
                  g3={d.tiers.g3.msgs} g3pct={d.tiers.g3.msgsPct}
                />
                <RecruitingCard
                  label="Samples Shipped" total={d.samples} pct={d.samplesPct}
                  g1={d.tiers.g1.samples} g1pct={d.tiers.g1.samplesPct}
                  g2={d.tiers.g2.samples} g2pct={d.tiers.g2.samplesPct}
                  g3={d.tiers.g3.samples} g3pct={d.tiers.g3.samplesPct}
                />
              </div>
            </section>

            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Top 15 Creators · by Store GMV</h2>
              <CreatorTable creators={report.tables.topCreators} />
            </section>

            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Top 15 Videos · by GMV</h2>
              <VideoTable videos={report.tables.topVideos} />
            </section>

            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Most Active Creators · by Videos Posted</h2>
              <ActiveCreatorTable creators={report.tables.activeCreators} />
            </section>
          </TabsContent>

          {/* ── WEEKLY TAB ── */}
          <TabsContent value="weekly">
            <AnalysisCard text={report.analysis?.weekly ?? ''} title="Weekly Trend Analysis" />
            <WeeklyCharts data={report.weekly_charts} />
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
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Revenue — GMV</p>
                      {goals.monthlyGmvTarget && (
                        <MonthlyTargetRow
                          label={`Monthly · ${goals.monthlyPeriod ?? currentMonthLabel}`}
                          mtd={mtdGmv} projected={projGmv} target={goals.monthlyGmvTarget}
                          fmt="currency" trend={gmvTrend} monthPct={monthPct}
                        />
                      )}
                      {goals.quarterlyGmvTarget && (
                        <TargetRow
                          label={`Quarterly · ${goals.quarterlyPeriod ?? 'Current Quarter'}`}
                          actual={qtdGmv} target={goals.quarterlyGmvTarget}
                          fmt="currency" note="last 3 months"
                        />
                      )}
                    </div>
                  )}

                  {/* Videos per month */}
                  {(goals.monthlyVideosTarget || goals.monthlyVideosG1Target || goals.monthlyVideosG2Target || goals.monthlyVideosG3Target) && (
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                        Videos · {goals.monthlyVideosPeriod ?? currentMonthLabel}
                      </p>
                      {goals.monthlyVideosTarget && (
                        <MonthlyTargetRow label="Total" mtd={mtdVideos} projected={projVideos} target={goals.monthlyVideosTarget} trend={vidTrend} monthPct={monthPct} />
                      )}
                      {goals.monthlyVideosG1Target && (
                        <MonthlyTargetRow label="G1" mtd={mtdVidG1} projected={projVidG1} target={goals.monthlyVideosG1Target} monthPct={monthPct} />
                      )}
                      {goals.monthlyVideosG2Target && (
                        <MonthlyTargetRow label="G2" mtd={mtdVidG2} projected={projVidG2} target={goals.monthlyVideosG2Target} monthPct={monthPct} />
                      )}
                      {goals.monthlyVideosG3Target && (
                        <MonthlyTargetRow label="G3" mtd={mtdVidG3} projected={projVidG3} target={goals.monthlyVideosG3Target} monthPct={monthPct} />
                      )}
                    </div>
                  )}

                  {/* Samples per month */}
                  {goals.monthlySamplesTarget && (
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                        Samples · {goals.monthlySamplesPeriod ?? currentMonthLabel}
                      </p>
                      <MonthlyTargetRow label="Samples Shipped" mtd={mtdSamples} projected={projSamples} target={goals.monthlySamplesTarget} trend={sampTrend} monthPct={monthPct} />
                    </div>
                  )}

                  {/* GMV Max Spend */}
                  {(goals.monthlyGmvMaxSpendTarget || goals.quarterlyGmvMaxSpendTarget) && (
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">GMV Max — Spend</p>
                      {goals.monthlyGmvMaxSpendTarget && (
                        <TargetRow
                          label={`Monthly · ${goals.monthlyGmvMaxSpendPeriod ?? currentMonthLabel}`}
                          actual={d.gmvMax.spend} target={goals.monthlyGmvMaxSpendTarget}
                          fmt="currency" note="30d"
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
                  {(goals.activeG1Target || goals.activeG2Target || goals.activeG3Target) && (
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Active Creators · 30-Day</p>
                      {goals.activeG1Target && (
                        <TargetRow label="G1" actual={d.tiers.g1.creators} target={goals.activeG1Target} />
                      )}
                      {goals.activeG2Target && (
                        <TargetRow label="G2" actual={d.tiers.g2.creators} target={goals.activeG2Target} />
                      )}
                      {goals.activeG3Target && (
                        <TargetRow label="G3" actual={d.tiers.g3.creators} target={goals.activeG3Target} />
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
