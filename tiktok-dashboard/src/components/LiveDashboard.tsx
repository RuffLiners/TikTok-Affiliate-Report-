'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { WeeklyReport, Goals } from '@/lib/types'
import { driveJob } from '@/lib/driveJob'
import { ManualEntryPanel } from './ManualEntryPanel'
import { D30Content } from './D30Content'

interface Props {
  report: WeeklyReport | null
  goals: Goals | null
}

function friendlyError(msg: string): string {
  if (msg.includes('Connection error while communicating with MCP')) return 'TikTok data server unavailable — try again in a moment.'
  if (msg.includes('Claude API 400') || msg.includes('invalid_request_error')) return 'Data query error — try again.'
  if (msg.includes('Claude API 5') || msg.includes('overloaded')) return 'Claude is busy — try again in a moment.'
  if (msg.includes('timeout') || msg.includes('Timeout')) return 'Data pull timed out — try again.'
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return 'Network error — check your connection and try again.'
  // truncate long raw JSON errors
  return msg.length > 120 ? msg.slice(0, 120) + '…' : msg
}

export default function LiveDashboard({ report, goals: _goals }: Props) {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const [phaseLabel, setPhaseLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showManual, setShowManual] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
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

      // poll for status label updates only — primary driver is the while loop below
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/jobs/${jobId}`)
          const job = await statusRes.json().catch(() => null)
          if (!job) return
          if (job.phase_label) setPhaseLabel(job.phase_label)
        } catch { /* ignore poll errors — while loop is the source of truth */ }
      }, 3000)

      // run phases sequentially until done — survives browser request timeouts
      await driveJob(jobId)

      // phases complete — stop poll, refresh data
      stopPoll()
      router.refresh()
      setRefreshing(false)

    } catch (e: any) {
      stopPoll()
      setError(friendlyError(String(e?.message || 'Connection error. Try again.')))
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-6">
      {showManual && (
        <ManualEntryPanel reportDate={report?.report_date ?? ''} onClose={() => setShowManual(false)} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Live · Last 30 Days</h2>
          {report ? (
            <p className="text-xs text-gray-400 mt-0.5">{report.data_window} · report from {report.label}</p>
          ) : (
            <p className="text-xs text-gray-400 mt-0.5">No data yet — refresh or use Manual Entry</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {error && <p className="text-xs text-red-600 max-w-xs text-right">{error}</p>}
          <button
            onClick={() => setShowManual(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-600 border border-gray-200 px-3 py-2 rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            ✎ Manual Entry
          </button>
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

      {report && <D30Content report={report} />}

    </div>
  )
}
