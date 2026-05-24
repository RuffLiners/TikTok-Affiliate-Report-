import { Video } from '@/lib/types'

const tierBadge = (ggmv: number) => {
  if (ggmv >= 100000) return { label: 'G3', cls: 'bg-amber-100 text-amber-700' }
  if (ggmv >= 25000)  return { label: 'G2', cls: 'bg-green-100 text-green-700' }
  return { label: 'G1', cls: 'bg-blue-100 text-blue-700' }
}

const f$ = (n: number) => '$' + n.toFixed(2)
const fN = (n: number) => n.toLocaleString('en-US')

interface Props { videos: Video[] }

export function VideoTable({ videos }: Props) {
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
            return (
              <tr key={`${v.h}-${i}`} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
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
                <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{v.date}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
