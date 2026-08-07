type Pct = number | null // null = prior value was 0, no meaningful delta
interface Props {
  label: string; total: number; pct: Pct
  l1: number; l1pct: Pct; l2: number; l2pct: Pct; l3: number; l3pct: Pct
  l4: number; l4pct: Pct; l5: number; l5pct: Pct; l6: number; l6pct: Pct
  l7: number; l7pct: Pct
}
import { num } from '@/lib/fmt'

const fK = (raw: number) => { const n = num(raw); return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n) }
const pctStr = (raw: Pct) => { if (raw == null) return '—'; const n = num(raw); return `${n >= 0 ? '↑+' : '↓-'}${Math.abs(n).toFixed(0)}%` }

export function RecruitingCard({ label, total, pct, l1, l1pct, l2, l2pct, l3, l3pct, l4, l4pct, l5, l5pct, l6, l6pct, l7, l7pct }: Props) {
  return (
    <div className="bg-gray-50 rounded-xl p-4">
      <div className="flex justify-between items-start mb-3">
        <p className="text-xs text-gray-400 font-medium">{label}</p>
        <div className="text-right">
          <p className="text-lg font-semibold text-gray-900">{fK(total)}</p>
          <p className={`text-xs font-medium ${pct == null ? 'text-gray-400' : pct >= 0 ? 'text-green-600' : 'text-red-500'}`}>{pctStr(pct)} vs prior</p>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">L1: {fK(l1)} {pctStr(l1pct)}</span>
        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">L2: {fK(l2)} {pctStr(l2pct)}</span>
        <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">L3: {fK(l3)} {pctStr(l3pct)}</span>
        <span className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full">L4: {fK(l4)} {pctStr(l4pct)}</span>
        <span className="text-xs bg-lime-50 text-lime-700 px-2 py-0.5 rounded-full">L5: {fK(l5)} {pctStr(l5pct)}</span>
        <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">L6: {fK(l6)} {pctStr(l6pct)}</span>
        <span className="text-xs bg-orange-50 text-orange-700 px-2 py-0.5 rounded-full">L7: {fK(l7)} {pctStr(l7pct)}</span>
      </div>
    </div>
  )
}
