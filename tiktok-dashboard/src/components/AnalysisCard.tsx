interface Props {
  text: string
  title?: string
  variant?: 'blue' | 'green' | 'purple' | 'orange'
}

const variantClasses = {
  blue:   { card: 'bg-blue-50 border-blue-100',     header: 'text-blue-400' },
  green:  { card: 'bg-green-50 border-green-100',   header: 'text-green-600' },
  purple: { card: 'bg-purple-50 border-purple-100', header: 'text-purple-600' },
  orange: { card: 'bg-orange-50 border-orange-100', header: 'text-orange-600' },
}

export function AnalysisCard({ text, title = 'Analysis', variant = 'blue' }: Props) {
  if (!text?.trim()) return null

  const paragraphs = text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(Boolean)

  const cls = variantClasses[variant]

  return (
    <div className={`${cls.card} border rounded-xl p-5 mb-6`}>
      <p className={`text-xs font-semibold ${cls.header} uppercase tracking-wider mb-3`}>
        {title}
      </p>
      <div className="space-y-3">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-sm text-gray-700 leading-relaxed">{p}</p>
        ))}
      </div>
    </div>
  )
}
