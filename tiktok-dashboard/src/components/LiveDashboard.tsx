'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { WeeklyReport, Goals } from '@/lib/types'
import { KpiCard } from './KpiCard'
import { TierCard } from './TierCard'
import { RecruitingCard } from './RecruitingCard'
import { CreatorTable } from './tables/CreatorTable'
import { VideoTable } from './tables/VideoTable'
import { ActiveCreatorTable } from './tables/ActiveCreatorTable'
import { AnalysisCard } from './AnalysisCard'
import { AgentsSection } from './AgentsSection'

interface Props {
  report: WeeklyReport
  goals: Goals | null
}

export function LiveDashboard({ report, goals: _goals }: Props) {
  const router = useRouter()
  const d = report.d30
  const [refreshing, setRefreshing] = useState(false)
  const [phaseLabel, setPhaseLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  async function runNextPhase(jobId: string) {
    const res = await fetch('/api/jobs/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      // also fetch job row to get the stored error message
      const jobRes = await fetch(`/api/jobs/${jobId}`).then(r => r.json()).catch(() => ({}))
      throw new Error(String(jobRes.error || data.error || `Phase failed (HTTP ${res.status})`))
    }
    return data.nextPhase
  }

  async function refresh() {
    setRefreshing(true)
    setError(null)
    setPhaseLabel('Starting…')

    try {
      // create job
      const createRes = await fetch('/api/jobs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobType: 'live_refresh', params: {} })
      })
      const createData = await createRes.json().catch(() => ({}))
      if (!createRes.ok || !createData.jobId) throw new Error(createData.error || 'Failed to create job')
      const { jobId } = createData

      // poll for status updates while running phases sequentially
      pollRef.current = setInterval(async () => {
        const statusRes = await fetch(`/api/jobs/${jobId}`)
        const job = await statusRes.json()
        if (job.phase_label) setPhaseLabel(job.phase_label)
        if (job.status === 'done') {
          stopPoll()
          router.refresh()
          setRefreshing(false)
        } else if (job.status === 'error') {
          stopPoll()
          setError(job.error || 'Refresh failed.')
          setRefreshing(false)
        }
      }, 3000)

      // run phases sequentially until done (live_refresh stops after phase 6)
      let nextPhase: number | null = 1
      while (nextPhase !== null) {
        nextPhase = await runNextPhase(jobId)
      }

    } catch (e: any) {
      stopPoll()
      setError(e?.message || 'Connection error. Try again.')
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Live · Last 30 Days</h2>
          <p className="text-xs text-gray-400 mt-0.5">{report.data_window} · report from {report.label}</p>
        </div>
        <div className="flex items-center gap-3">
          {error && <p className="text-xs text-red-600 max-w-xs text-right">{error}</p>}
          <button
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-2 text-sm font-medium bg-gray-900 text-white px-4 py-2 rounded-xl hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {refreshing ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                {phaseLabel || 'Pulling live data…'}
              </>
            ) : (
              <>↺ Refresh live data</>
            )}
          </button>
        </div>
      </div>

      {refreshing && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4">
          <p className="text-xs text-gray-500">{phaseLabel || 'Connecting to TikTok Shop data…'}</p>
        </div>
      )}

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
        <div className="grid grid-cols-3 gap-3">
          <KpiCard label="Ad Spend"   value={d.gmvMax.spend}   format="currency" />
          <KpiCard label="Ad Revenue" value={d.gmvMax.revenue} format="currency" />
          <KpiCard label="ROI"        value={d.gmvMax.roi}     format="roi" />
        </div>
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

      {report.tables.topCreators?.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Top 15 Creators · by Store GMV</h3>
          <CreatorTable creators={report.tables.topCreators} />
        </section>
      )}

      {report.tables.topVideos?.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Top 15 Videos · by GMV</h3>
          <VideoTable videos={report.tables.topVideos} reportDate={report.report_date} />
        </section>
      )}

      {report.tables.activeCreators?.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Most Active Creators · by Videos Posted</h3>
          <ActiveCreatorTable creators={report.tables.activeCreators} />
        </section>
      )}

      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Outreach &amp; CRM Agents · Last 30 Days</h3>
        <AgentsSection reportDate={report.report_date} />
      </section>

    </div>
  )
}
