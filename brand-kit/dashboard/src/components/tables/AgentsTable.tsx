'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
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

const COLS = [
  { key: 'id',                label: 'ID',             defaultW: 64,  right: false },
  { key: 'date',              label: 'Date',           defaultW: 72,  right: false },
  { key: 'name',              label: 'Campaign Name',  defaultW: 180, right: false },
  { key: 'status',            label: 'Status',         defaultW: 82,  right: false },
  { key: 'gmv_filter',        label: 'GMV Filter',     defaultW: 100, right: false },
  { key: 'kw_filter',         label: 'KW / Search',    defaultW: 130, right: false },
  { key: 'other_filters',     label: 'Other Filters',  defaultW: 160, right: false },
  { key: 'list_segment',      label: 'List / Segment', defaultW: 160, right: false },
  { key: 'commission',        label: 'Comm.',          defaultW: 82,  right: false },
  { key: 'creators_reached',  label: 'Conv.',          defaultW: 60,  right: true  },
  { key: 'remaining',         label: 'Remain.',        defaultW: 60,  right: true  },
  { key: 'total_invites',     label: 'Invites',        defaultW: 56,  right: true  },
  { key: 'accepted_invites',  label: 'Accepted',       defaultW: 60,  right: true  },
  { key: 'total_replies',     label: 'Replies',        defaultW: 54,  right: true  },
  { key: 'samples_requested', label: 'Smp Req.',       defaultW: 58,  right: true  },
  { key: 'samples_shipped',   label: 'Shipped',        defaultW: 54,  right: true  },
  { key: 'total_videos',      label: 'Videos',         defaultW: 54,  right: true  },
  { key: 'total_revenue',     label: 'Revenue',        defaultW: 78,  right: true  },
  { key: 'product_count',     label: 'Prods.',         defaultW: 50,  right: true  },
  { key: 'has_followups',     label: 'F/U',            defaultW: 44,  right: false },
]

const TD  = 'px-2 py-2 text-xs text-gray-700 align-top whitespace-nowrap overflow-hidden text-ellipsis'
const TDW = 'px-2 py-2 text-xs text-gray-500 align-top whitespace-normal leading-snug break-words overflow-hidden'
const TDR = 'px-2 py-2 text-xs text-gray-700 text-right align-top whitespace-nowrap overflow-hidden'

export function AgentsTable({ agents }: { agents: OutreachAgentRow[]; reportDate?: string }) {
  const sorted = [...agents].sort((a, b) =>
    new Date(b.date_posted).getTime() - new Date(a.date_posted).getTime()
  )

  const tot = sorted.reduce((acc, r) => ({
    creators_reached:  acc.creators_reached  + (r.creators_reached  || 0),
    total_invites:     acc.total_invites     + (r.total_invites     || 0),
    accepted_invites:  acc.accepted_invites  + (r.accepted_invites  || 0),
    total_replies:     acc.total_replies     + (r.total_replies     || 0),
    samples_requested: acc.samples_requested + (r.samples_requested || 0),
    samples_shipped:   acc.samples_shipped   + (r.samples_shipped   || 0),
    total_videos:      acc.total_videos      + (r.total_videos      || 0),
    total_revenue:     acc.total_revenue     + (r.total_revenue     || 0),
  }), { creators_reached:0, total_invites:0, accepted_invites:0, total_replies:0,
        samples_requested:0, samples_shipped:0, total_videos:0, total_revenue:0 })

  const [colWidths, setColWidths] = useState<number[]>(COLS.map(c => c.defaultW))
  const dragging = useRef<{ colIdx: number; startX: number; startW: number } | null>(null)

  const onMouseDown = useCallback((colIdx: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = { colIdx, startX: e.clientX, startW: colWidths[colIdx] }
  }, [colWidths])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      const { colIdx, startX, startW } = dragging.current
      setColWidths(prev => {
        const next = [...prev]
        next[colIdx] = Math.max(36, startW + (e.clientX - startX))
        return next
      })
    }
    function onUp() { dragging.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  const totalW = colWidths.reduce((s, w) => s + w, 0)

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm w-full overflow-hidden">
      {/* Single scroll container — horizontal + vertical. max-height ~15 rows + header */}
      <div className="overflow-auto w-full" style={{ maxHeight: '564px' }}>
        <table className="text-sm border-collapse table-fixed" style={{ width: totalW + 'px', minWidth: totalW + 'px' }}>
          <colgroup>
            {colWidths.map((w, i) => <col key={i} style={{ width: w + 'px' }} />)}
          </colgroup>

          <thead>
            <tr className="border-b border-gray-100 bg-gray-50" style={{ position: 'sticky', top: 0, zIndex: 10 }}>
              {COLS.map((col, i) => (
                <th
                  key={col.key}
                  className={`relative px-2 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap select-none bg-gray-50 ${col.right ? 'text-right' : 'text-left'}`}
                  style={{ width: colWidths[i] }}
                >
                  <span className="block overflow-hidden text-ellipsis pr-2">{col.label}</span>
                  {/* Resize handle */}
                  <span
                    onMouseDown={onMouseDown(i)}
                    className="absolute right-0 top-0 h-full w-2.5 cursor-col-resize flex items-center justify-center group"
                    style={{ userSelect: 'none' }}
                  >
                    <span className="w-px h-4 bg-gray-200 group-hover:bg-blue-400 transition-colors" />
                  </span>
                </th>
              ))}
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
                <td className={TDW + ' font-medium text-gray-900'} title={a.name}>{a.name}</td>
                <td className="px-2 py-2 align-top"><StatusBadge status={a.status} /></td>
                <td className={TD} title={a.gmv_filter || ''}>{a.gmv_filter || '—'}</td>
                <td className={TDW} title={a.kw_filter || ''}>{a.kw_filter || '—'}</td>
                <td className={TDW} title={a.other_filters || ''}>{a.other_filters || '—'}</td>
                <td className={TDW} title={a.list_segment || ''}>{a.list_segment || '—'}</td>
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
