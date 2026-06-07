'use client'

import { OutreachAgentRow } from '@/lib/types'
import { AgentsTable } from './tables/AgentsTable'

interface Props {
  reportDate: string
  initialAgents?: OutreachAgentRow[]
}

export function AgentsSection({ reportDate, initialAgents }: Props) {
  const agents = initialAgents ?? []
  const outreachAgents = agents.filter(a => a.agent_type === 'outreach')
  const crmAgents = agents.filter(a => a.agent_type === 'crm')
  const hasData = agents.length > 0

  return (
    <div className="space-y-4">
      {!hasData && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center">
          <p className="text-sm text-gray-400">No agent data — refresh live data or use Manual Entry to populate.</p>
        </div>
      )}

      {hasData && (
        <div className="space-y-4">
          {outreachAgents.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Outreach Agents · {outreachAgents.length}
              </h4>
              <AgentsTable agents={outreachAgents} reportDate={reportDate} />
            </div>
          )}
          {crmAgents.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                CRM Agents · {crmAgents.length}
              </h4>
              <AgentsTable agents={crmAgents} reportDate={reportDate} />
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
