import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
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

export const revalidate = 3600

interface Props { params: Promise<{ reportDate: string }> }

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
          </TabsList>

          {/* ── 30 DAY TAB ── */}
          <TabsContent value="30d" className="space-y-6">
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
            <WeeklyCharts data={report.weekly_charts} />
          </TabsContent>

          {/* ── MONTHLY TAB ── */}
          <TabsContent value="monthly">
            <MonthlyCharts data={report.monthly_charts} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
