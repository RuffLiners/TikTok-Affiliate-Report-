'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  reportDate: string
  onClose: () => void
}

export function ManualEntryPanel({ reportDate, onClose }: Props) {
  const router = useRouter()
  const [prompt, setPrompt] = useState('')
  const [dataWindow, setDataWindow] = useState('')
  const [copied, setCopied] = useState(false)
  const [json, setJson] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`/api/live-manual?reportDate=${reportDate}`)
      .then(r => r.json())
      .then(d => { setPrompt(d.prompt || ''); setDataWindow(d.dataWindow || '') })
      .catch(() => {})
  }, [reportDate])

  async function copy() {
    await navigator.clipboard.writeText(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function save() {
    setSaving(true); setError(null); setSaved(false)

    let parsed: any
    try { parsed = JSON.parse(json.trim()) }
    catch { setError('Invalid JSON — check for syntax errors.'); setSaving(false); return }

    // Accept new format (d30/tables/agents) or legacy A1-A6 format
    const isNewFormat = parsed.d30 !== undefined
    const isLegacyFormat = parsed.A1 !== undefined
    if (!isNewFormat && !isLegacyFormat) {
      setError('Missing d30 data. Make sure you pasted the full JSON response.')
      setSaving(false); return
    }
    const phaseData: any = {}
    const keys = isNewFormat
      ? ['d30', 'tables', 'agents']
      : ['A1','A2','A3','A4','A5','A6','topCreators','topVideos','activeCreators','agents']
    for (const k of keys) {
      if (parsed[k] !== undefined) phaseData[k] = parsed[k]
    }

    const res = await fetch('/api/live-manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phaseData, reportDate })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error || 'Save failed.'); setSaving(false); return }

    setSaved(true); setSaving(false)
    router.refresh()
    setTimeout(onClose, 1500)
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
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-4">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4 space-y-5 flex-1">

          {/* Step 1 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-700">Step 1 · Copy this prompt into Claude + Euka</p>
              <button
                onClick={copy}
                disabled={!prompt}
                className="flex items-center gap-1.5 text-xs font-medium bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
              >
                {copied ? (
                  <><svg className="w-3.5 h-3.5 text-green-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>Copied!</>
                ) : (
                  <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy prompt</>
                )}
              </button>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-600 font-mono whitespace-pre-wrap leading-relaxed border border-gray-100 max-h-52 overflow-y-auto">
              {prompt || 'Loading…'}
            </div>
          </div>

          {/* Step 2 */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-700">Step 2 · Paste Claude's JSON response here</p>
            <textarea
              value={json}
              onChange={e => setJson(e.target.value)}
              placeholder={'{\n  "d30": {"gmv": 175917, "gmvPct": 840, "orders": 1088, ..., "tiers": {"g1": {...}, "g2": {...}, "g3": {...}}},\n  "tables": {"topCreators": [...], "topVideos": [...], "activeCreators": [...]},\n  "agents": [...]\n}'}
              className="w-full h-52 text-xs font-mono bg-gray-50 border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-none"
            />
          </div>

          {error && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-700">{error}</div>}
          {saved && <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-xs text-green-700 font-medium">✓ Saved — dashboard is updating…</div>}
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
