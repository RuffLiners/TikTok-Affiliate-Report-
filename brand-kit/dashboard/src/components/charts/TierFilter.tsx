'use client'

export const TIERS = [
  { key: 'l1', label: 'L1', color: '#94a3b8' },
  { key: 'l2', label: 'L2', color: '#3b82f6' },
  { key: 'l3', label: 'L3', color: '#22c55e' },
  { key: 'l4', label: 'L4', color: '#14b8a6' },
  { key: 'l5', label: 'L5', color: '#84cc16' },
  { key: 'l6', label: 'L6', color: '#f59e0b' },
  { key: 'l7', label: 'L7', color: '#f97316' },
] as const

export type TierKey = (typeof TIERS)[number]['key']

export const ALL_TIERS: TierKey[] = TIERS.map(t => t.key)

interface Props {
  active: TierKey[]
  onChange: (keys: TierKey[]) => void
}

// Clickable tier chips: toggle individual levels on/off, "All" resets.
// Charts render only the active tiers and rescale to fit.
export function TierFilter({ active, onChange }: Props) {
  const allOn = active.length === TIERS.length
  const toggle = (k: TierKey) =>
    onChange(active.includes(k) ? active.filter(x => x !== k) : [...ALL_TIERS.filter(t => active.includes(t) || t === k)])
  return (
    <div className="flex gap-1.5 mb-3 flex-wrap items-center">
      <button
        onClick={() => onChange(ALL_TIERS)}
        className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
          allOn ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
        }`}
      >
        All
      </button>
      {TIERS.map(t => {
        const on = active.includes(t.key)
        return (
          <button
            key={t.key}
            onClick={() => toggle(t.key)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
              on ? 'text-gray-800 border-gray-300 bg-white' : 'text-gray-300 border-gray-100 bg-gray-50 hover:border-gray-200'
            }`}
          >
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: on ? t.color : '#d1d5db' }} />
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
