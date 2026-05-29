'use client'

import { OutreachAgentRow } from '@/lib/types'

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'running' ? 'bg-green-100 text-green-700' :
    status === 'error'   ? 'bg-red-100 text-red-700' :
                           'bg-gray-100 text-gray-500'
  const dot =
    status === 'running' ? 'bg-green-500' :
    status === 'error'   ? 'bg-red-500'   : 'bg-gray-400'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {status}
    </span>
  )
}

function N({ v }: { v: number }) {
  if (!v) return <span className="text-gray-300">—</span>
  return <>{v.toLocaleString()}</>
}

function fmt(v: number) {
  if (!v) return '—'
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

const TH = 'px-3 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap'
const TD = 'px-3 py-2.5 text-xs text-gray-700 whitespace-nowrap'
const TDR = 'px-3 py-2.5 text-xs text-gray-700 text-right whitespace-nowrap'

export function AgentsTable({ agents }: { agents: OutreachAgentRow[] }) {
  const sorted = [...agents].sort((a, b) =>
    new Date(b.date_posted).getTime() - new Date(a.date_posted).getTime()
  )

  // totals row
  const tot = sorted.reduce((acc, r) => ({
    creators_reached: acc.creators_reached + (r.creators_reached || 0),
    total_invites:    acc.total_invites    + (r.total_invites    || 0),
    accepted_invites: acc.accepted_invites + (r.accepted_invites || 0),
    total_replies:    acc.total_replies    + (r.total_replies    || 0),
    samples_requested:acc.samples_requested+ (r.samples_requested||0),
    samples_shipped:  acc.samples_shipped  + (r.samples_shipped  || 0),
    total_videos:     acc.total_videos     + (r.total_videos     || 0),
    total_revenue:    acc.total_revenue    + (r.total_revenue    || 0),
  }), { creators_reached:0, total_invites:0, accepted_invites:0, total_replies:0,
        samples_requested:0, samples_shipped:0, total_videos:0, total_revenue:0 })

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className={TH}>Campaign ID</th>
              <th className={TH}>Date Created</th>
              <th className={TH + ' min-w-[180px]'}>Campaign Name</th>
              <th className={TH}>Status</th>
              <th className={TH}>GMV Filter</th>
              <th className={TH + ' min-w-[140px]'}>KW / Search Filter</th>
              <th className={TH + ' min-w-[180px]'}>Other Attribute Filters</th>
              <th className={TH + ' min-w-[220px]'}>List / Segment</th>
              <th className={TH}>Comm.</th>
              <th className={TH + ' text-right'}>Conversations</th>
              <th className={TH + ' text-right'}>Remaining</th>
              <th className={TH + ' text-right'}>Target Invites</th>
              <th className={TH + ' text-right'}>Accepted</th>
              <th className={TH + ' text-right'}>Replies</th>
              <th className={TH + ' text-right'}>Sample Req.</th>
              <th className={TH + ' text-right'}>Shipped</th>
              <th className={TH + ' text-right'}>Videos</th>
              <th className={TH + ' text-right'}>Revenue</th>
              <th className={TH + ' text-right'}>Products</th>
              <th className={TH}>Followups</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {sorted.map(a => (
              <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                <td className={TD + ' text-gray-400'}>{a.id}</td>
                <td className={TD}>
                  {a.date_posted
                    ? new Date(a.date_posted).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })
                    : '—'}
                </td>
                <td className={TD + ' font-medium text-gray-900'}>{a.name}</td>
                <td className="px-3 py-2.5"><StatusBadge status={a.status} /></td>
                <td className={TD}>{a.gmv_filter || '—'}</td>
                <td className={TD + ' text-gray-500'}>{a.kw_filter || '—'}</td>
                <td className={TD + ' text-gray-500 max-w-[200px] whitespace-normal leading-tight'}>{a.other_filters || '—'}</td>
                <td className={TD + ' text-gray-500 max-w-[240px] whitespace-normal leading-tight'}>{a.list_segment || '—'}</td>
                <td className={TD}>{a.commission_display || '—'}</td>
                <td className={TDR + ' font-medium'}><N v={a.creators_reached} /></td>
                <td className={TDR}><N v={a.remaining} /></td>
                <td className={TDR}><N v={a.total_invites} /></td>
                <td className={TDR}><N v={a.accepted_invites} /></td>
                <td className={TDR}><N v={a.total_replies} /></td>
                <td className={TDR}><N v={a.samples_requested} /></td>
                <td className={TDR}><N v={a.samples_shipped} /></td>
                <td className={TDR}><N v={a.total_videos} /></td>
                <td className={TDR}>{a.total_revenue > 0 ? fmt(a.total_revenue) : <span className="text-gray-300">—</span>}</td>
                <td className={TDR}><N v={a.product_count} /></td>
                <td className={TD}>{a.has_followups ? <span className="text-amber-600 font-medium">Yes</span> : <span className="text-gray-300">No</span>}</td>
              </tr>
            ))}
          </tbody>
          {sorted.length > 1 && (
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                <td className={TD + ' text-gray-500'} colSpan={9}>TOTAL ({sorted.length})</td>
                <td className={TDR}>{tot.creators_reached.toLocaleString()}</td>
                <td className={TDR}>—</td>
                <td className={TDR}>{tot.total_invites.toLocaleString()}</td>
                <td className={TDR}>{tot.accepted_invites.toLocaleString()}</td>
                <td className={TDR}>{tot.total_replies.toLocaleString()}</td>
                <td className={TDR}>{tot.samples_requested.toLocaleString()}</td>
                <td className={TDR}>{tot.samples_shipped.toLocaleString()}</td>
                <td className={TDR}>{tot.total_videos.toLocaleString()}</td>
                <td className={TDR}>{tot.total_revenue > 0 ? fmt(tot.total_revenue) : '—'}</td>
                <td className={TDR}>—</td>
                <td className={TD}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
