import { Video } from '@/lib/types'

const tierBadge = (ggmv: number) => {
  if (ggmv >= 100000) return { label: 'G3', cls: 'bg-amber-100 text-amber-700' }
  if (ggmv >= 25000)  return { label: 'G2', cls: 'bg-green-100 text-green-700' }
  return { label: 'G1', cls: 'bg-blue-100 text-blue-700' }
}

const f$ = (n: number) => '$' + n.toFixed(2)
const fN = (n: number) => n.toLocaleString('en-US')

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function daysSincePosted(dateStr: string, reportDate: string): number | null {
  const parts = dateStr.split(' ')
  if (parts.length !== 2) return null
  const month = MONTHS.indexOf(parts[0])
  const day = parseInt(parts[1])
  if (month === -1 || isNaN(day)) return null
  const year = parseInt(reportDate.slice(0, 4))
  const videoDate = new Date(year, month, day)
  const report = new Date(reportDate + 'T00:00:00')
  // If video date is > 60 days in the future, it's from the prior year
  if (videoDate.getTime() - report.getTime() > 60 * 24 * 60 * 60 * 1000) {
    videoDate.setFullYear(year - 1)
  }
  const diff = Math.round((report.getTime() - videoDate.getTime()) / (1000 * 60 * 60 * 24))
  return diff >= 0 ? diff : null
}

interface Props { videos: Video[]; reportDate?: string }

export function VideoTable({ videos, reportDate }: Props) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr>
            {['#','Creator','Product','GMV','Views','Orders','AOV','CVR','Likes','Comments','Prod Clicks','Posted'].map(h => (
              <th key={h} className="px-3 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {videos.map((v, i) => {
            const badge = tierBadge(v.ggmv)
            const cvr = v.views > 0 ? (v.ord / v.views * 100).toFixed(3) + '%' : '—'
            const age = reportDate ? daysSincePosted(v.date, reportDate) : null
            const isNew = age !== null && age <= 30
            const isThisWeek = age !== null && age <= 7
            return (
              <tr key={`${v.h}-${i}`} className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${isNew ? 'bg-emerald-50/40' : ''}`}>
                <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badge.cls}`}>{badge.label}</span>
                    <a href={`https://tiktok.com/@${v.h}`} target="_blank" rel="noopener noreferrer"
                      className="text-gray-800 hover:text-blue-600 hover:underline font-medium">
                      @{v.h}
                    </a>
                  </div>
                </td>
                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{v.prod}</td>
                <td className="px-3 py-2 font-medium text-gray-900">{f$(v.gmv)}</td>
                <td className="px-3 py-2 text-gray-600">{fN(v.views)}</td>
                <td className="px-3 py-2 text-gray-600">{v.ord}</td>
                <td className="px-3 py-2 text-gray-600">{f$(v.aov)}</td>
                <td className="px-3 py-2 text-gray-600">{cvr}</td>
                <td className="px-3 py-2 text-gray-600">{fN(v.likes)}</td>
                <td className="px-3 py-2 text-gray-600">{v.cmt}</td>
                <td className="px-3 py-2 text-gray-600">{v.clicks ?? '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <span className={isThisWeek ? 'text-emerald-700 font-semibold' : 'text-gray-400'}>{v.date}</span>
                    {isThisWeek && <span className="bg-emerald-100 text-emerald-700 text-[10px] font-semibold px-1.5 py-0.5 rounded">This Week</span>}
                    {isNew && !isThisWeek && <span className="bg-blue-100 text-blue-600 text-[10px] font-semibold px-1.5 py-0.5 rounded">New</span>}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
