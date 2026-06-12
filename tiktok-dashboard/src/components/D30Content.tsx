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

export function D30Content({ report }: Props) {
  const d = report.d30

  return (
    <div className="space-y-6">
      <AnalysisCard text={report.analysis?.d30 ?? ''} title="30-Day Analysis" />

      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Overview</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Total GMV"     value={d.gmv}    format="currency" pct={d.gmvPct} />
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
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">By Creator Tier</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <TierCard tier="g1" label="Group 1 · <$25K"      data={d.tiers.g1} color="blue" />
          <TierCard tier="g2" label="Group 2 · $25K–$100K" data={d.tiers.g2} color="green" />
          <TierCard tier="g3" label="Group 3 · >$100K"     data={d.tiers.g3} color="amber" />
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

      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Recruiting</h3>
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

      {report.tables?.topCreators?.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Top 15 Creators · by Store GMV</h3>
          <CreatorTable creators={report.tables.topCreators} />
        </section>
      )}

      {report.tables?.topVideos?.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Top 15 Videos · by GMV</h3>
          <VideoTable videos={report.tables.topVideos} reportDate={report.report_date} />
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
        <AgentsSection reportDate={report.report_date} initialAgents={report.agents} />
      </section>
    </div>
  )
}
