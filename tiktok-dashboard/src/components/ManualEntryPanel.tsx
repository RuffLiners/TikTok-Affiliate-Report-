'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface PhasePrompt { phase: number; label: string; key: string; prompt: string }

interface Props {
  reportDate: string
  onClose: () => void
}

export function ManualEntryPanel({ reportDate, onClose }: Props) {
  const router = useRouter()
  const [prompts, setPrompts] = useState<PhasePrompt[]>([])
  const [dataWindow, setDataWindow] = useState('')
  const [openPhase, setOpenPhase] = useState<number | null>(1)
  const [copied, setCopied] = useState<number | null>(null)
  const [json, setJson] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`/api/live-manual?reportDate=${reportDate}`)
      .then(r => r.json())
      .then(d => { setPrompts(d.prompts || []); setDataWindow(d.dataWindow || '') })
      .catch(() => {})
  }, [reportDate])

  async function copyPrompt(p: PhasePrompt) {
    await navigator.clipboard.writeText(p.prompt)
    setCopied(p.phase)
    setTimeout(() => setCopied(null), 2000)
  }

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)

    let parsed: any
    try {
      parsed = JSON.parse(json.trim())
    } catch {
      setError('Invalid JSON — check for syntax errors and try again.')
      setSaving(false)
      return
    }

    // Accept either merged {A1:{...},A2:{...},...} or individual phase objects
    const phaseData: any = {}
    for (const key of ['A1','A2','A3','A4','A5','A6']) {
      if (parsed[key]) phaseData[key] = parsed[key]
    }

    if (!phaseData.A1) {
      setError('Missing A1 data. Paste all 6 phase responses merged into one JSON object.')
      setSaving(false)
      return
    }

    const res = await fetch('/api/live-manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phaseData, reportDate })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Save failed.')
      setSaving(false)
      return
    }

    setSaved(true)
    setSaving(false)
    router.refresh()
    setTimeout(onClose, 1200)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[95vh] overflow-y-auto flex flex-col mt-2"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">Manual Entry · Live 30-Day</h2>
            {dataWindow && <p className="text-xs text-gray-400 mt-0.5">{dataWindow}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors ml-4">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4 space-y-4 flex-1">
          {/* Instructions */}
          <div className="bg-blue-50 rounded-xl p-4 text-xs text-blue-800 leading-relaxed">
            <p className="font-semibold mb-1">How to use</p>
            <ol className="list-decimal list-inside space-y-1 text-blue-700">
              <li>Open Claude.ai with the Euka MCP connector enabled</li>
              <li>Copy each prompt below and run it — Claude will respond with JSON</li>
              <li>Merge all 6 JSON responses into one object and paste below</li>
              <li>Click Save — the Live 30-day numbers will update immediately</li>
            </ol>
          </div>

          {/* Phase prompts */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Step 1 · Run each prompt in Claude + Euka</p>
            {prompts.map(p => (
              <div key={p.phase} className="border border-gray-100 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                  onClick={() => setOpenPhase(openPhase === p.phase ? null : p.phase)}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-xs flex items-center justify-center font-semibold flex-shrink-0">{p.phase}</span>
                    <div>
                      <span className="text-xs font-medium text-gray-800">{p.label}</span>
                      <span className="ml-2 text-xs text-gray-400 font-mono">→ {p.key}</span>
                    </div>
                  </div>
                  <svg className={`w-4 h-4 text-gray-400 transition-transform ${openPhase === p.phase ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openPhase === p.phase && (
                  <div className="px-4 pb-4">
                    <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 font-mono whitespace-pre-wrap leading-relaxed border border-gray-100 max-h-48 overflow-y-auto">
                      {p.prompt}
                    </div>
                    <button
                      onClick={() => copyPrompt(p)}
                      className="mt-2 flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      {copied === p.phase ? (
                        <><svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg><span className="text-green-600">Copied!</span></>
                      ) : (
                        <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy prompt</>
                      )}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Paste area */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Step 2 · Paste all 6 responses merged</p>
            <p className="text-xs text-gray-400">Combine all Claude responses into one JSON object like: <span className="font-mono bg-gray-100 px-1 rounded">{"{"}"A1":{"{"}...{"}"},"A2":{"{"}...{"}"},..."A6":{"{"}...{"}"} {"}"}</span></p>
            <textarea
              value={json}
              onChange={e => setJson(e.target.value)}
              placeholder={`{\n  "A1": {"gmv": 173311, "orders": 1086, ...},\n  "A2": {"gmv": 85000, "orders": 537, ...},\n  "A3": {"g1": {...}, "g2": {...}, "g3": {...}},\n  "A4": {"total": {...}, "g1": {...}, ...},\n  "A5": {"total": {...}, "g1": {...}, ...},\n  "A6": {"spend": 19863, "revenue": 63553, "roi": 3.20}\n}`}
              className="w-full h-52 text-xs font-mono bg-gray-50 border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-none"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-700">{error}</div>
          )}
          {saved && (
            <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-xs text-green-700 font-medium">✓ Saved — dashboard is updating…</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between sticky bottom-0 bg-white">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
          <button
            onClick={save}
            disabled={saving || !json.trim()}
            className="flex items-center gap-2 text-sm font-medium bg-gray-900 text-white px-5 py-2 rounded-xl hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <><svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Saving…</>
            ) : 'Save to Dashboard'}
          </button>
        </div>
      </div>
    </div>
  )
}
