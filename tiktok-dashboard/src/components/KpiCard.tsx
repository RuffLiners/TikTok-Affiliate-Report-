import { cn } from '@/lib/utils'

interface Props {
  label: string
  value: number
  format: 'currency' | 'number' | 'compact' | 'percent' | 'roi'
  pct?: number
  delta?: number
  deltaSuffix?: string
}

function fmt(value: number, format: string) {
  if (format === 'currency') return '$' + Math.round(value).toLocaleString('en-US')
  if (format === 'compact') {
    if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M'
    if (value >= 1000) return (value / 1000).toFixed(0) + 'K'
    return value.toLocaleString()
  }
  if (format === 'percent') return value.toFixed(2) + '%'
  if (format === 'roi') return value.toFixed(2) + 'x'
  return value.toLocaleString('en-US')
}

export function KpiCard({ label, value, format, pct, delta, deltaSuffix = '%' }: Props) {
  const change = pct ?? delta
  const isUp = (change ?? 0) >= 0
  const isNeutral = change === 0 || change == null

  return (
    <div className="bg-gray-50 rounded-xl p-4">
      <p className="text-xs text-gray-400 font-medium mb-1">{label}</p>
      <p className="text-2xl font-semibold text-gray-900">{fmt(value, format)}</p>
      {change != null && (
        <p className={cn('text-xs font-medium mt-1', isNeutral ? 'text-gray-400' : isUp ? 'text-green-600' : 'text-red-500')}>
          {isNeutral ? '→ 0' : `${isUp ? '↑' : '↓'} ${Math.abs(change).toFixed(1)}`}{deltaSuffix} vs prior
        </p>
      )}
    </div>
  )
}
