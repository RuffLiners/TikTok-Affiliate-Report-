interface Props {
  text: string
  title?: string
}

export function AnalysisCard({ text, title = 'Analysis' }: Props) {
  if (!text?.trim()) return null

  const paragraphs = text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(Boolean)

  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 mb-6">
      <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3">
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
