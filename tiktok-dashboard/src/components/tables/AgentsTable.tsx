'use client'

import { useState } from 'react'
import { OutreachAgentRow } from '@/lib/types'

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'running' ? 'bg-green-100 text-green-700' :
    status === 'error'   ? 'bg-red-100 text-red-700' :
                           'bg-gray-100 text-gray-500'
  const dot =
    status === 'running' ? 'bg-green-500' :
    status === 'error'   ? 'bg-red-500' :
                           'bg-gray-400'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {status}
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  const cls = type === 'crm'
    ? 'bg-purple-100 text-purple-700'
    : 'bg-blue-100 text-blue-700'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {type.toUpperCase()}
    </span>
  )
}

function CampaignTypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    target_collab_with_message: 'Collab + Msg',
    message: 'Message',
    message_with_photo: 'Msg + Photo',
    message_with_spark_code: 'Spark Code',
    message_with_creative_brief: 'Creative Brief',
  }
  return (
    <span className="text-xs text-gray-500">{labels[type] ?? type}</span>
  )
}

function MessageModal({ agent, onClose }: { agent: OutreachAgentRow; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm leading-tight">{agent.name}</h3>
            <p className="text-xs text-gray-400 mt-0.5">{new Date(agent.date_posted).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors ml-4 flex-shrink-0"
          >
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {agent.message && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Outreach Message</p>
            <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed border border-gray-100">
              {agent.message}
            </div>
          </div>
        )}

        {agent.collab_message && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Collaboration Invite Message</p>
            <div className="bg-blue-50 rounded-xl p-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed border border-blue-100">
              {agent.collab_message}
            </div>
          </div>
        )}

        {!agent.message && !agent.collab_message && (
          <p className="text-sm text-gray-400 italic">No message content available.</p>
        )}
      </div>
    </div>
  )
}

function TargetAudience({ agent }: { agent: OutreachAgentRow }) {
  const parts: string[] = []
  if (agent.target_categories?.length)   parts.push(agent.target_categories.join(', '))
  if (agent.target_gmvs?.length)          parts.push(`GMV: ${agent.target_gmvs.join(', ')}`)
  if (agent.target_avg_views?.length)     parts.push(`Views: ${agent.target_avg_views.join(', ')}`)
  if (agent.target_followers?.length)     parts.push(`Flw: ${agent.target_followers.join(', ')}`)
  if (agent.target_gender)               parts.push(`Gender: ${agent.target_gender}`)
  if (agent.target_engagement != null)   parts.push(`Eng ≥ ${agent.target_engagement}%`)

  if (!parts.length) {
    return <span className="text-xs text-gray-400">{agent.targeting_method === 'list' ? 'List-based' : agent.targeting_method === 'segment' ? 'Segment' : '—'}</span>
  }

  return (
    <div className="flex flex-wrap gap-1">
      {parts.map((p, i) => (
        <span key={i} className="inline-block bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded">
          {p}
        </span>
      ))}
    </div>
  )
}

export function AgentsTable({ agents }: { agents: OutreachAgentRow[] }) {
  const [activeMsg, setActiveMsg] = useState<OutreachAgentRow | null>(null)
  const [sortKey, setSortKey] = useState<'date' | 'reached' | 'remaining' | 'samples'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sorted = [...agents].sort((a, b) => {
    let av = 0, bv = 0
    if (sortKey === 'date')      { av = new Date(a.date_posted).getTime(); bv = new Date(b.date_posted).getTime() }
    if (sortKey === 'reached')   { av = a.creators_reached; bv = b.creators_reached }
    if (sortKey === 'remaining') { av = a.remaining; bv = b.remaining }
    if (sortKey === 'samples')   { av = a.samples_requested; bv = b.samples_requested }
    return sortDir === 'desc' ? bv - av : av - bv
  })

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const SortBtn = ({ col, label }: { col: typeof sortKey; label: string }) => (
    <button
      onClick={() => toggleSort(col)}
      className={`flex items-center gap-0.5 hover:text-gray-700 transition-colors ${sortKey === col ? 'text-gray-700 font-semibold' : ''}`}
    >
      {label}
      <span className="text-gray-300">{sortKey === col ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>
    </button>
  )

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Agent</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                  <SortBtn col="date" label="Date" />
                </th>
                <th className="text-right px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                  <SortBtn col="reached" label="Reached" />
                </th>
                <th className="text-right px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                  <SortBtn col="remaining" label="Remaining" />
                </th>
                <th className="text-right px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                  <SortBtn col="samples" label="Samples Req." />
                </th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Target Audience</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Products</th>
                <th className="text-right px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Invites</th>
                <th className="text-right px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Videos</th>
                <th className="text-right px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Revenue</th>
                <th className="px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Options</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sorted.map(agent => (
                <tr key={agent.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 min-w-[220px]">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-gray-900 text-xs leading-tight">{agent.name}</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <TypeBadge type={agent.agent_type} />
                        <StatusBadge status={agent.status} />
                        <CampaignTypeBadge type={agent.campaign_type} />
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-600">
                    {new Date(agent.date_posted).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-3 py-3 text-right text-xs font-medium text-gray-800">
                    {agent.creators_reached.toLocaleString()}
                  </td>
                  <td className="px-3 py-3 text-right text-xs text-gray-600">
                    {agent.remaining.toLocaleString()}
                  </td>
                  <td className="px-3 py-3 text-right text-xs text-gray-600">
                    <div>{agent.samples_requested}</div>
                    {agent.samples_shipped > 0 && (
                      <div className="text-gray-400">{agent.samples_shipped} shipped</div>
                    )}
                  </td>
                  <td className="px-3 py-3 min-w-[200px]">
                    <TargetAudience agent={agent} />
                  </td>
                  <td className="px-3 py-3 min-w-[160px]">
                    {agent.products?.length ? (
                      <div className="flex flex-col gap-0.5">
                        {agent.products.map(p => {
                          const comm = agent.commission?.find(c => c.productId === p.id)
                          return (
                            <div key={p.id} className="flex items-center gap-1">
                              <span className="text-xs text-gray-700 leading-tight">{p.title}</span>
                              {comm && <span className="text-xs text-gray-400 flex-shrink-0">{comm.rate}%</span>}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-xs text-gray-600">
                    {agent.total_invites > 0 ? (
                      <div>
                        <div>{agent.total_invites.toLocaleString()}</div>
                        <div className="text-gray-400">{agent.accepted_invites} acc.</div>
                      </div>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right text-xs text-gray-600">
                    {agent.total_videos > 0 ? agent.total_videos : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right text-xs text-gray-600">
                    {agent.total_revenue > 0
                      ? '$' + agent.total_revenue.toLocaleString('en-US', { maximumFractionDigits: 0 })
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-500">
                    <div className="flex flex-col gap-0.5">
                      {agent.use_ai_personalization && <span className="text-indigo-500">AI ✓</span>}
                      {agent.has_followups && <span className="text-amber-500">Follow-ups</span>}
                      {agent.free_samples && <span className="text-teal-500">Free samples</span>}
                      {agent.daily_limit != null && <span>Limit: {agent.daily_limit}/day</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {(agent.message || agent.collab_message) && (
                      <button
                        onClick={() => setActiveMsg(agent)}
                        className="text-xs text-blue-500 hover:text-blue-700 font-medium transition-colors whitespace-nowrap"
                      >
                        View msg
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {activeMsg && <MessageModal agent={activeMsg} onClose={() => setActiveMsg(null)} />}
    </>
  )
}
