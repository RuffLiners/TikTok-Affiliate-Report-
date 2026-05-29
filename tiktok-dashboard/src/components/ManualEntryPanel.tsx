'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  reportDate: string
  onClose: () => void
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
    >
      {copied ? (
        <><svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg><span className="text-green-600">Copied!</span></>
      ) : (
        <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy prompt</>
      )}
    </button>
  )
}

export function ManualEntryPanel({ reportDate, onClose }: Props) {
  const router = useRouter()
  const [promptKpi, setPromptKpi] = useState('')
  const [promptTables, setPromptTables] = useState('')
  const [dataWindow, setDataWindow] = useState('')
  const [json, setJson] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [activeTab, setActiveTab] = useState<'kpi' | 'tables'>('kpi')

  useEffect(() => {
    fetch(`/api/live-manual?reportDate=${reportDate}`)
      .then(r => r.json())
      .then(d => {
        setPromptKpi(d.promptKpi || '')
        setPromptTables(d.promptTables || '')
        setDataWindow(d.dataWindow || '')
      })
      .catch(() => {})
  }, [reportDate])

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)

    let parsed: any
    try { parsed = JSON.parse(json.trim()) }
    catch { setError('Invalid JSON — check for syntax errors.'); setSaving(false); return }

    // Accept A1-A6 + optional table keys merged in one object
    const phaseData: any = {}
    for (const k of ['A1','A2','A3','A4','A5','A6','topCreators','topVideos','activeCreators']) {
      if (parsed[k] !== undefined) phaseData[k] = parsed[k]
    }

    if (!phaseData.A1) {
      setError('Missing A1. Run Prompt 1 first and include its output.')
      setSaving(false); return
    }

    const res = await fetch('/api/live-manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phaseData, reportDate })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error || 'Save failed.'); setSaving(false); return }

    setSaved(true)
    setSaving(false)
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

          {/* Instructions */}
          <div className="bg-blue-50 rounded-xl p-4 text-xs text-blue-800 leading-relaxed">
            <p className="font-semibold mb-1">2-step process</p>
            <ol className="list-decimal list-inside space-y-1 text-blue-700">
              <li>Open Claude.ai with the Euka MCP connector</li>
              <li>Run <strong>Prompt 1</strong> (KPIs) — copy the JSON response</li>
              <li>Run <strong>Prompt 2</strong> (Tables) — copy the JSON response</li>
              <li>Merge both responses into one object and paste below, then Save</li>
            </ol>
            <p className="mt-2 text-blue-600">You can also paste just Prompt 1 to update KPIs only, or just Prompt 2 to update tables only.</p>
          </div>

          {/* Prompt tabs */}
          <div>
            <div className="flex gap-1 mb-3">
              <button
                onClick={() => setActiveTab('kpi')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeTab === 'kpi' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
              >
                Prompt 1 · KPIs
              </button>
              <button
                onClick={() => setActiveTab('tables')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeTab === 'tables' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
              >
                Prompt 2 · Tables
              </button>
            </div>

            {activeTab === 'kpi' && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Fetches: current KPIs, prior KPIs, tier breakdown, outreach (current + prior), GMV Max — returns A1 through A6.</p>
                <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-700 font-mono whitespace-pre-wrap leading-relaxed border border-gray-100 max-h-56 overflow-y-auto">
                  {promptKpi || 'Loading…'}
                </div>
                {promptKpi && <CopyButton text={promptKpi} />}
              </div>
            )}

            {activeTab === 'tables' && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Fetches: top 15 creators by GMV, top 15 videos by GMV, most active creators — returns topCreators, topVideos, activeCreators.</p>
                <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-700 font-mono whitespace-pre-wrap leading-relaxed border border-gray-100 max-h-56 overflow-y-auto">
                  {promptTables || 'Loading…'}
                </div>
                {promptTables && <CopyButton text={promptTables} />}
              </div>
            )}
          </div>

          {/* Paste area */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Paste Claude's response(s)</p>
            <p className="text-xs text-gray-400">
              Merge both responses into one object:{' '}
              <span className="font-mono bg-gray-100 px-1 rounded text-gray-600">{'{"A1":{...},...,"topCreators":[...],...}'}</span>
              {' '}or paste just one at a time.
            </p>
            <textarea
              value={json}
              onChange={e => setJson(e.target.value)}
              placeholder={`{\n  "A1": {"gmv": 173311, "orders": 1086, "videos": 516, "views": 6900000, "creators": 114, "newCreators": 72, "retention": 36.84},\n  "A2": {"gmv": 85000, ...},\n  "A3": {"g1": {...}, "g2": {...}, "g3": {...}},\n  "A4": {"total": {...}, ...},\n  "A5": {"total": {...}, ...},\n  "A6": {"spend": 19863, "revenue": 63553, "roi": 3.20}\n}`}
              className="w-full h-48 text-xs font-mono bg-gray-50 border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-none"
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
