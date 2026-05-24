import { TierData } from '@/lib/types'
import { cn } from '@/lib/utils'

interface Props { tier: string; label: string; data: TierData; color: 'blue' | 'green' | 'amber' }

const colors = {
  blue:  { bg: 'bg-blue-50',   label: 'text-blue-600',  value: 'text-blue-900' },
  green: { bg: 'bg-green-50',  label: 'text-green-600', value: 'text-green-900' },
  amber: { bg: 'bg-amber-50',  label: 'text-amber-600', value: 'text-amber-900' },
}

const f$ = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export function TierCard({ label, data, color }: Props) {
  const c = colors[color]
  return (
    <div className={cn('rounded-xl p-4', c.bg)}>
      <p className={cn('text-xs font-semibold uppercase tracking-wider mb-3', c.label)}>{label}</p>
      <div className="space-y-1.5">
        {[
          ['Creators', data.creators],
          ['New creators', data.newCreators],
          ['Videos', data.videos],
          ['GMV', f$(data.gmv)],
          ['GMV / creator', f$(Math.round(data.gmv / Math.max(data.creators, 1)))],
        ].map(([k, v]) => (
          <div key={String(k)} className="flex justify-between text-sm">
            <span className={cn('text-xs', c.label)}>{k}</span>
            <span className={cn('font-semibold text-xs', c.value)}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
