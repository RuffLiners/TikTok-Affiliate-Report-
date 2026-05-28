'use client'

import { useState, useEffect } from 'react'
import { OutreachAgentRow } from '@/lib/types'
import { AgentsTable } from './tables/AgentsTable'

export function AgentsSection({ reportDate }: { reportDate: string }) {
  const [agents, setAgents] = useState<OutreachAgentRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/agents?reportDate=${reportDate}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load agents')
      setAgents(json.agents ?? [])
      setLoaded(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportDate])

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 flex items-center justify-center gap-3">
        <svg className="animate-spin h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-sm text-gray-500">Loading outreach agents…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-red-100 shadow-sm p-6 flex items-center justify-between">
        <p className="text-sm text-red-600">{error}</p>
        <button
          onClick={load}
          className="text-sm text-blue-500 hover:text-blue-700 font-medium transition-colors ml-4"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!loaded) return null

  if (!agents || agents.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 text-center text-sm text-gray-400">
        No outreach or CRM agents found for this 30-day window.
      </div>
    )
  }

  const outreachAgents = agents.filter(a => a.agent_type === 'outreach')
  const crmAgents      = agents.filter(a => a.agent_type === 'crm')

  return (
    <div className="space-y-4">
      {outreachAgents.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Outreach Agents · {outreachAgents.length}
          </h3>
          <AgentsTable agents={outreachAgents} />
        </div>
      )}
      {crmAgents.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            CRM Agents · {crmAgents.length}
          </h3>
          <AgentsTable agents={crmAgents} />
        </div>
      )}
    </div>
  )
}
