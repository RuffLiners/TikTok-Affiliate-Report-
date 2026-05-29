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
      disabled={!text}
      className="flex items-center gap-1.5 text-xs font-medium bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
    >
      {copied ? (
        <><svg className="w-3.5 h-3.5 text-green-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>Copied!</>
      ) : (
        <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy prompt</>
      )}
    </button>
  )
}

export function ManualEntryPanel({ reportDate: _reportDate, onClose }: Props) {
  const router = useRouter()

  const [prompt, setPrompt] = useState('')
  const [agentsPrompt, setAgentsPrompt] = useState('')
  const [dataWindow, setDataWindow] = useState('')

  const [dataJson, setDataJson] = useState('')
  const [agentsJson, setAgentsJson] = useState('')

  const [savingData, setSavingData] = useState(false)
  const [savingAgents, setSavingAgents] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)
  const [agentsError, setAgentsError] = useState<string | null>(null)
  const [dataSaved, setDataSaved] = useState(false)
  const [agentsSaved, setAgentsSaved] = useState(false)

  useEffect(() => {
    fetch(`/api/live-manual`)
      .then(r => r.json())
      .then(d => {
        setPrompt(d.prompt || '')
        setAgentsPrompt(d.agentsPrompt || '')
        setDataWindow(d.dataWindow || '')
      })
      .catch(() => {})
  }, [])

  async function saveData() {
    setSavingData(true); setDataError(null); setDataSaved(false)
    let parsed: any
    try { parsed = JSON.parse(dataJson.trim()) }
    catch { setDataError('Invalid JSON — check for syntax errors.'); setSavingData(false); return }

    const isNewFormat = parsed.d30 !== undefined
    const isLegacyFormat = parsed.A1 !== undefined
    if (!isNewFormat && !isLegacyFormat) {
      setDataError('Missing d30 data. Make sure you pasted the full JSON response.')
      setSavingData(false); return
    }
    const phaseData: any = {}
    const keys = isNewFormat
      ? ['d30', 'tables']
      : ['A1','A2','A3','A4','A5','A6','topCreators','topVideos','activeCreators']
    for (const k of keys) { if (parsed[k] !== undefined) phaseData[k] = parsed[k] }

    const res = await fetch('/api/live-manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phaseData })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setDataError(data.error || 'Save failed.'); setSavingData(false); return }
    setDataSaved(true); setSavingData(false)
    router.refresh()
  }

  async function saveAgents() {
    setSavingAgents(true); setAgentsError(null); setAgentsSaved(false)
    let parsed: any
    try { parsed = JSON.parse(agentsJson.trim()) }
    catch { setAgentsError('Invalid JSON — check for syntax errors.'); setSavingAgents(false); return }
    if (!Array.isArray(parsed)) {
      setAgentsError('Expected a JSON array [ ... ] of agents.')
      setSavingAgents(false); return
    }

    const res = await fetch('/api/live-manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phaseData: parsed, agentsOnly: true })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setAgentsError(data.error || 'Save failed.'); setSavingAgents(false); return }
    setAgentsSaved(true); setSavingAgents(false)
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

        <div className="px-6 py-4 space-y-6 flex-1">

          {/* ── PART 1: Main data ── */}
          <div className="space-y-3">
            <p className="text-xs font-bold text-gray-800 uppercase tracking-wider">Part 1 · KPIs &amp; Tables</p>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-700">Step 1 · Copy prompt into Claude + Euka</p>
                <CopyButton text={prompt} />
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-600 font-mono whitespace-pre-wrap leading-relaxed border border-gray-100 max-h-40 overflow-y-auto">
                {prompt || 'Loading…'}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-700">Step 2 · Paste Claude's JSON response</p>
              <textarea
                value={dataJson}
                onChange={e => setDataJson(e.target.value)}
                placeholder={'{\n  "d30": {"gmv": 94307, "gmvPct": 11.5, ..., "tiers": {...}},\n  "tables": {"topCreators": [...], "topVideos": [...], "activeCreators": [...]}\n}'}
                className="w-full h-40 text-xs font-mono bg-gray-50 border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-none"
              />
            </div>

            {dataError && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-700">{dataError}</div>}
            {dataSaved && <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-xs text-green-700 font-medium">✓ KPI &amp; table data saved</div>}

            <div className="flex justify-end">
              <button
                onClick={saveData}
                disabled={savingData || !dataJson.trim()}
                className="flex items-center gap-2 text-sm font-medium bg-gray-900 text-white px-5 py-2 rounded-xl hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                {savingData ? (
                  <><svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Saving…</>
                ) : 'Save KPIs & Tables'}
              </button>
            </div>
          </div>

          <div className="border-t border-gray-100" />

          {/* ── PART 2: Agents ── */}
          <div className="space-y-3">
            <p className="text-xs font-bold text-gray-800 uppercase tracking-wider">Part 2 · Outreach &amp; CRM Agents</p>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-700">Step 3 · Copy agents prompt into Claude + Euka</p>
                <CopyButton text={agentsPrompt} />
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-600 font-mono whitespace-pre-wrap leading-relaxed border border-gray-100 max-h-40 overflow-y-auto">
                {agentsPrompt || 'Loading…'}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-700">Step 4 · Paste Claude's agents JSON array</p>
              <textarea
                value={agentsJson}
                onChange={e => setAgentsJson(e.target.value)}
                placeholder={'[\n  {"id": 235728, "name": "G2 - 5/28/2026", "agent_type": "outreach", ...},\n  ...\n]'}
                className="w-full h-40 text-xs font-mono bg-gray-50 border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-none"
              />
            </div>

            {agentsError && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-700">{agentsError}</div>}
            {agentsSaved && <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-xs text-green-700 font-medium">✓ Agents saved — dashboard is updating…</div>}

            <div className="flex justify-end">
              <button
                onClick={saveAgents}
                disabled={savingAgents || !agentsJson.trim()}
                className="flex items-center gap-2 text-sm font-medium bg-gray-900 text-white px-5 py-2 rounded-xl hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                {savingAgents ? (
                  <><svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Saving…</>
                ) : 'Save Agents'}
              </button>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 sticky bottom-0 bg-white flex justify-start">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}
