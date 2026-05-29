'use client'

import { useState } from 'react'
import { OutreachAgentRow } from '@/lib/types'
import { AgentsTable } from './tables/AgentsTable'

interface Props {
  reportDate: string
  initialAgents?: OutreachAgentRow[]
}

export function AgentsSection({ reportDate, initialAgents }: Props) {
  const [agents, setAgents] = useState<OutreachAgentRow[] | null>(initialAgents ?? null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(!!initialAgents?.length)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/agents?reportDate=${reportDate}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load agents')
      const fetched: OutreachAgentRow[] = json.agents ?? []
      setAgents(fetched)

      // Save to report for persistence
      setSaving(true)
      const saveRes = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportDate, agents: fetched })
      })
      const saveJson = await saveRes.json()
      if (!saveRes.ok) console.warn('Agents save failed:', saveJson.error)
      else setSaved(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
      setSaving(false)
    }
  }

  const outreachAgents = agents?.filter(a => a.agent_type === 'outreach') ?? []
  const crmAgents = agents?.filter(a => a.agent_type === 'crm') ?? []
  const hasData = agents !== null && agents.length > 0

  return (
    <div className="space-y-4">

      {/* Header row with refresh button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {saved && !loading && (
            <span className="text-xs text-green-600 font-medium">Saved to report</span>
          )}
          {error && <p className="text-xs text-red-600 max-w-xs">{error}</p>}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 text-xs font-medium bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <>
              <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              {saving ? 'Saving…' : 'Pulling agents…'}
            </>
          ) : (
            <>↺ {hasData ? 'Refresh Agents' : 'Pull Agents'}</>
          )}
        </button>
      </div>

      {/* Content */}
      {!hasData && !loading && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center">
          <p className="text-sm text-gray-400 mb-1">No agent data loaded yet.</p>
          <p className="text-xs text-gray-300">Click &ldquo;Pull Agents&rdquo; to fetch from TikTok Shop and save to this report.</p>
        </div>
      )}

      {loading && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4 flex items-center gap-3">
          <svg className="animate-spin h-4 w-4 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <span className="text-sm text-gray-500">Pulling outreach agents from TikTok Shop…</span>
        </div>
      )}

      {hasData && !loading && (
        <div className="space-y-4">
          {outreachAgents.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Outreach Agents · {outreachAgents.length}
              </h4>
              <AgentsTable agents={outreachAgents} />
            </div>
          )}
          {crmAgents.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                CRM Agents · {crmAgents.length}
              </h4>
              <AgentsTable agents={crmAgents} />
            </div>
          )}
          {outreachAgents.length === 0 && crmAgents.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 text-center text-sm text-gray-400">
              No outreach or CRM agents found for this 30-day window.
            </div>
          )}
        </div>
      )}

    </div>
  )
}
