import { WeeklyCreatorRow } from '@/lib/types'
import { num, fmtNum, fmtUsd } from '@/lib/fmt'

const tierBadge = (ggmv: number) => {
  if (ggmv >= 1500000) return { label: 'L7', cls: 'bg-orange-100 text-orange-700' }
  if (ggmv >= 400000)  return { label: 'L6', cls: 'bg-amber-100 text-amber-700' }
  if (ggmv >= 150000)  return { label: 'L5', cls: 'bg-lime-100 text-lime-700' }
  if (ggmv >= 60000)   return { label: 'L4', cls: 'bg-teal-100 text-teal-700' }
  if (ggmv >= 25000)   return { label: 'L3', cls: 'bg-green-100 text-green-700' }
  if (ggmv >= 5000)    return { label: 'L2', cls: 'bg-blue-100 text-blue-700' }
  return { label: 'L1', cls: 'bg-slate-100 text-slate-600' }
}

const f$ = fmtUsd
const fN = fmtNum

interface Props {
  creators: WeeklyCreatorRow[]
  highlight?: 'gmv' | 'vid'
}

export function WeeklyCreatorTable({ creators, highlight = 'gmv' }: Props) {
  const headers = ['#', 'Creator', 'Videos', 'GMV', 'Views', 'Orders', 'AOV']
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr>
            {headers.map(h => (
              <th key={h} className="px-3 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {creators.map((c, i) => {
            const badge = tierBadge(num(c.ggmv))
            return (
              <tr key={`${c.h}-${i}`} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badge.cls}`}>{badge.label}</span>
                    <a href={`https://tiktok.com/@${c.h}`} target="_blank" rel="noopener noreferrer"
                      className="text-gray-800 hover:text-blue-600 hover:underline font-medium">
                      @{c.h}
                    </a>
                  </div>
                </td>
                <td className={`px-3 py-2 ${highlight === 'vid' ? 'font-semibold text-gray-900 bg-blue-50' : 'text-gray-600'}`}>{c.vid}</td>
                <td className={`px-3 py-2 ${highlight === 'gmv' ? 'font-semibold text-gray-900 bg-green-50' : 'text-gray-600'}`}>{f$(c.gmv)}</td>
                <td className="px-3 py-2 text-gray-600">{fN(c.views)}</td>
                <td className="px-3 py-2 text-gray-600">{c.ord}</td>
                <td className="px-3 py-2 text-gray-600">{f$(c.aov)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
