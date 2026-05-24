interface Props {
  label: string; total: number; pct: number
  g1: number; g1pct: number; g2: number; g2pct: number; g3: number; g3pct: number
}
const fK = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n)
const pctStr = (n: number) => `${n >= 0 ? '↑+' : '↓-'}${Math.abs(n).toFixed(0)}%`

export function RecruitingCard({ label, total, pct, g1, g1pct, g2, g2pct, g3, g3pct }: Props) {
  return (
    <div className="bg-gray-50 rounded-xl p-4">
      <div className="flex justify-between items-start mb-3">
        <p className="text-xs text-gray-400 font-medium">{label}</p>
        <div className="text-right">
          <p className="text-lg font-semibold text-gray-900">{fK(total)}</p>
          <p className={`text-xs font-medium ${pct >= 0 ? 'text-green-600' : 'text-red-500'}`}>{pctStr(pct)} vs prior</p>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">G1: {fK(g1)} {pctStr(g1pct)}</span>
        <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">G2: {fK(g2)} {pctStr(g2pct)}</span>
        <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">G3: {fK(g3)} {pctStr(g3pct)}</span>
      </div>
    </div>
  )
}
