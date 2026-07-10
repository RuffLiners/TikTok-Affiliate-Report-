import { WeeklyReport } from '@/lib/types'
import { KpiCard } from './KpiCard'
import { TierCard } from './TierCard'
import { RecruitingCard } from './RecruitingCard'
import { CreatorTable } from './tables/CreatorTable'
import { VideoTable } from './tables/VideoTable'
import { ActiveCreatorTable } from './tables/ActiveCreatorTable'
import { AnalysisCard } from './AnalysisCard'
import { AgentsSection } from './AgentsSection'
import { GmvMaxAgeTable } from './GmvMaxAgeTable'

interface Props {
  report: WeeklyReport
}

const EMPTY_TIER = { creators: 0, newCreators: 0, videos: 0, views: 0, gmv: 0, msgs: 0, msgsPct: 0, samples: 0, samplesPct: 0 }

export function D30Content({ report }: Props) {
  const d = report.d30
  // Reports/live snapshots saved before the L1-L7 refactor only carry g1-g3 tiers
  const t = (k: string) => ((d.tiers as any)?.[k] ?? EMPTY_TIER)
  const isMonthlyReport = (d as any).reportType === 'monthly'
  // Monthly report keys ('YYYY-MM-M') aren't parseable dates — use the window end
  const dateRef = isMonthlyReport ? ((d as any).windowEnd ?? '') : report.report_date

  return (
    <div className="space-y-6">
      <AnalysisCard text={report.analysis?.d30 ?? ''} title={isMonthlyReport ? 'Monthly Analysis' : '30-Day Analysis'} />

      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Overview</h3>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <KpiCard label="Total GMV"     value={d.shopGmv ?? d.gmv}      format="currency" pct={d.gmvPct} />
          <KpiCard label="Affiliate GMV" value={d.affiliateGmv ?? d.gmv} format="currency" pct={d.affiliateGmvPct ?? d.gmvPct} />
          <KpiCard label="Orders"        value={d.orders} format="number"   pct={d.ordersPct} />
          <KpiCard label="Videos Posted" value={d.videos} format="number"   pct={d.videosPct} />
          <KpiCard label="Total Views"   value={d.views}  format="compact"  pct={d.viewsPct} />
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Creator KPIs</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <KpiCard label="Creators Posted" value={d.creators}    format="number"  pct={d.creatorsPct} />
          <KpiCard label="New Creators"    value={d.newCreators} format="number"  pct={d.newCreatorsPct} />
          <KpiCard label="Retention Rate"  value={d.retention}   format="percent" delta={d.retentionDelta} deltaSuffix="pp" />
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">By Creator Level</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          <TierCard tier="l1" label="L1 · <$5K"         data={t('l1')} color="slate" />
          <TierCard tier="l2" label="L2 · $5K–$25K"     data={t('l2')} color="blue" />
          <TierCard tier="l3" label="L3 · $25K–$60K"    data={t('l3')} color="green" />
          <TierCard tier="l4" label="L4 · $60K–$150K"   data={t('l4')} color="teal" />
          <TierCard tier="l5" label="L5 · $150K–$400K"  data={t('l5')} color="lime" />
          <TierCard tier="l6" label="L6 · $400K–$1.5M"  data={t('l6')} color="amber" />
          <TierCard tier="l7" label="L7 · $1.5M+"       data={t('l7')} color="orange" />
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">GMV Max</h3>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <KpiCard label="Ad Spend"   value={d.gmvMax.spend}   format="currency" />
          <KpiCard label="Ad Revenue" value={d.gmvMax.revenue} format="currency" />
          <KpiCard label="ROI"        value={d.gmvMax.roi}     format="roi" />
        </div>
        {d.gmvMaxByAge && d.gmvMaxByAge.length > 0 && (
          <>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 mt-4">Spend by Content Age</p>
            <GmvMaxAgeTable
              rows={d.gmvMaxByAge}
              totalSpend={d.gmvMax.spend}
              totalRevenue={d.gmvMax.revenue}
              totalRoi={d.gmvMax.roi}
            />
          </>
        )}
      </section>

      {report.tables?.topCreators?.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Top 15 Creators · by Store GMV</h3>
          <CreatorTable creators={report.tables.topCreators} />
        </section>
      )}

      {report.tables?.topVideos?.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Top 15 Videos · by GMV</h3>
          <VideoTable videos={report.tables.topVideos} reportDate={dateRef} />
        </section>
      )}

      {report.tables?.activeCreators?.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Most Active Creators · by Videos Posted</h3>
          <ActiveCreatorTable creators={report.tables.activeCreators} />
        </section>
      )}

      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Outreach &amp; CRM Agents · Last 30 Days</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
          <RecruitingCard
            label="Messages Sent" total={d.msgs} pct={d.msgsPct}
            l1={t('l1').msgs} l1pct={t('l1').msgsPct}
            l2={t('l2').msgs} l2pct={t('l2').msgsPct}
            l3={t('l3').msgs} l3pct={t('l3').msgsPct}
            l4={t('l4').msgs} l4pct={t('l4').msgsPct}
            l5={t('l5').msgs} l5pct={t('l5').msgsPct}
            l6={t('l6').msgs} l6pct={t('l6').msgsPct}
            l7={t('l7').msgs} l7pct={t('l7').msgsPct}
          />
          <RecruitingCard
            label="Samples Shipped" total={d.samples} pct={d.samplesPct}
            l1={t('l1').samples} l1pct={t('l1').samplesPct}
            l2={t('l2').samples} l2pct={t('l2').samplesPct}
            l3={t('l3').samples} l3pct={t('l3').samplesPct}
            l4={t('l4').samples} l4pct={t('l4').samplesPct}
            l5={t('l5').samples} l5pct={t('l5').samplesPct}
            l6={t('l6').samples} l6pct={t('l6').samplesPct}
            l7={t('l7').samples} l7pct={t('l7').samplesPct}
          />
        </div>
        <AgentsSection reportDate={report.report_date} initialAgents={report.agents} />
      </section>
    </div>
  )
}
