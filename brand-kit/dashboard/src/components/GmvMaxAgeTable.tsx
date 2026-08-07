import { num, fmtUsd } from '@/lib/fmt'

interface AgeRow { label: string; videos: number; spend: number; revenue: number; roi: number; pct: number }
interface Props { rows: AgeRow[]; totalSpend: number; totalRevenue: number; totalRoi: number }

const f$ = fmtUsd
const fx = (n: number) => num(n).toFixed(2) + '×'

export function GmvMaxAgeTable({ rows, totalSpend, totalRevenue, totalRoi }: Props) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-4 py-2.5 font-semibold text-gray-400 uppercase tracking-wider">Content Age</th>
              <th className="text-right px-3 py-2.5 font-semibold text-gray-400 uppercase tracking-wider">Videos</th>
              <th className="text-right px-3 py-2.5 font-semibold text-gray-400 uppercase tracking-wider">Spend</th>
              <th className="text-right px-3 py-2.5 font-semibold text-gray-400 uppercase tracking-wider">Revenue</th>
              <th className="text-right px-3 py-2.5 font-semibold text-gray-400 uppercase tracking-wider">ROI</th>
              <th className="px-4 py-2.5 font-semibold text-gray-400 uppercase tracking-wider w-28">Spend %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-2.5 font-medium text-gray-800">{row.label}</td>
                <td className="px-3 py-2.5 text-right text-gray-600">{row.videos}</td>
                <td className="px-3 py-2.5 text-right text-gray-800 font-semibold">{f$(row.spend)}</td>
                <td className="px-3 py-2.5 text-right text-gray-800">{f$(row.revenue)}</td>
                <td className={`px-3 py-2.5 text-right font-semibold ${num(row.roi) >= 4 ? 'text-green-600' : num(row.roi) >= 3 ? 'text-gray-800' : 'text-amber-600'}`}>
                  {fx(row.roi)}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-violet-400 rounded-full" style={{ width: `${Math.min(num(row.pct), 100)}%` }} />
                    </div>
                    <span className="text-gray-500 w-8 text-right">{Math.round(num(row.pct))}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50">
              <td className="px-4 py-2.5 font-semibold text-gray-700">Total</td>
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5 text-right font-semibold text-gray-900">{f$(totalSpend)}</td>
              <td className="px-3 py-2.5 text-right font-semibold text-gray-900">{f$(totalRevenue)}</td>
              <td className="px-3 py-2.5 text-right font-semibold text-gray-900">{fx(totalRoi)}</td>
              <td className="px-4 py-2.5" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
