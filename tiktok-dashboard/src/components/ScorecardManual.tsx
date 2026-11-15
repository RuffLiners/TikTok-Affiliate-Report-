'use client'
import { useEffect, useState } from 'react'
import { addDays, monthRanges, weekRanges, LINE_BY_KEY, LineKey } from '@/lib/scorecard'

type Mode = 'week' | 'month' | 'month_check'
const COFUNDED: LineKey[] = ['gmvCofunded']
const HISTORY: { key: LineKey; hint: string }[] = [
  { key: 'grossRevenue', hint: 'Only for periods before Euka history (before 2025-10-28)' },
  { key: 'gmv', hint: 'Only for periods before Euka retention' },
  { key: 'views', hint: 'Only where Euka has no history' },
  { key: 'eukaMessages', hint: 'Only where Euka has no history' },
]
const CHECKS: { key: LineKey; hint: string }[] = [
  { key: 'grossRevenue', hint: 'Seller Center Ads dashboard, "Gross revenue"' },
  { key: 'gmv', hint: 'Seller Center Shop analytics, "GMV"' },
  { key: 'gmvMaxSpend', hint: 'Seller Center Ads dashboard, cost' },
  { key: 'gmvMaxRoi', hint: 'Seller Center Ads dashboard, ROI' },
]
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

export function ScorecardManual() {
  const [type, setType] = useState<Mode>('week')
  const [key, setKey] = useState('')
  const [vals, setVals] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [entries, setEntries] = useState<any[]>([])
  const [csv, setCsv] = useState('')
  const [busy, setBusy] = useState(false)

  const today = laToday()
  const weeks = weekRanges(today, 26).map(w => ({ k: w.key, l: `Week ${w.start} to ${w.end}` }))
  const months = monthRanges(addDays(today, -1)).map(m => ({ k: m.key, l: m.partial ? `${m.key} (month to date)` : m.key }))
  const options = type === 'week' ? weeks : months.filter(m => type === 'month' || !m.l.includes('to date'))
  useEffect(() => { try { setName(localStorage.getItem('rl-sc-name') || '') } catch {} }, [])
  useEffect(() => { setKey(options[0]?.k ?? '') }, [type]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    const r = await fetch('/api/admin/scorecard-manual'); if (r.ok) setEntries((await r.json()).entries ?? [])
  }
  useEffect(() => { load() }, [])

  async function save() {
    const list = Object.entries(vals).filter(([, v]) => v.trim() !== '').map(([line, value]) => ({ period_type: type, period_key: key, line, value }))
    if (!list.length) { setMsg({ ok: false, text: 'Enter at least one value. Leave a field blank for "no data"; blank is never saved as 0.' }); return }
    setBusy(true); setMsg(null)
    try { localStorage.setItem('rl-sc-name', name) } catch {}
    const r = await fetch('/api/admin/scorecard-manual', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enteredBy: name, entries: list }) })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (r.ok && j.ok) { setMsg({ ok: true, text: `Saved ${j.saved} value(s). The scorecard updates on next page load.` }); setVals({}); load() }
    else setMsg({ ok: false, text: (j.errors?.join('; ') || j.error || 'Save failed') })
  }
  async function del(e: any) {
    if (!confirm(`Delete ${e.line} for ${e.period_key}?`)) return
    await fetch(`/api/admin/scorecard-manual?period_type=${e.period_type}&period_key=${e.period_key}&line=${e.line}&by=${encodeURIComponent(name || 'unknown')}`, { method: 'DELETE' })
    load()
  }
  async function runImport(dryRun: boolean) {
    setBusy(true); setMsg(null)
    const r = await fetch('/api/admin/scorecard-import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv, enteredBy: name, dryRun }) })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (r.ok && j.ok) { setMsg({ ok: true, text: dryRun ? `Valid. Would save ${j.wouldSave} value(s); ${j.blankCellsSkipped} blank cell(s) skipped as "no data".` : `Imported ${j.saved} value(s); ${j.blankCellsSkipped} blank cell(s) skipped.` }); if (!dryRun) { setCsv(''); load() } }
    else setMsg({ ok: false, text: (j.errors || [j.error]).join(' | ') })
  }

  const input = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm'
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Scorecard: Seller Center values</h3>
        <p className="text-xs text-gray-500 mt-1">Gross Revenue and GMV come from Euka and match Seller Center. Euka has no field for GMV with TikTok co-funding, so enter it here from Seller Center Shop analytics, per week or month. The other fields only fill history Euka cannot reach. A monthly spot-check compares Euka to Seller Center and flags anything over 2 percent. Your name and the time are stored with every value.</p>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-xs text-gray-500">Your name<input className={input} value={name} onChange={e => setName(e.target.value)} placeholder="Who is entering this" /></label>
        <label className="text-xs text-gray-500">Period type
          <select className={input} value={type} onChange={e => setType(e.target.value as Mode)}><option value="week">Week (Sun to Sat)</option><option value="month">Month</option><option value="month_check">Monthly spot-check</option></select></label>
        <label className="text-xs text-gray-500">Period<select className={input} value={key} onChange={e => setKey(e.target.value)}>{options.map(o => <option key={o.k} value={o.k}>{o.l}</option>)}</select></label>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {(type === 'month_check' ? CHECKS : [...COFUNDED.map(k => ({ key: k, hint: 'Seller Center Shop analytics, "Gross merchandise value (with TikTok co-funding)". Not in Euka, so this is the one line you enter.' })), ...HISTORY]).map(f => (
          <label key={f.key} className="text-xs text-gray-500">{LINE_BY_KEY[f.key].label}<span className="text-gray-300"> · {f.hint}</span>
            <input className={input} inputMode="decimal" value={vals[f.key] ?? ''} onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))} placeholder="blank = no data" /></label>
        ))}
      </div>
      <button onClick={save} disabled={busy || !name.trim() || !key} className="bg-gray-900 text-white text-sm font-medium px-5 py-2 rounded-xl hover:bg-gray-800 disabled:opacity-40">Save values</button>

      <div className="border-t border-gray-100 pt-5 space-y-2">
        <h4 className="text-sm font-semibold text-gray-900">One-time CSV import (Seller Center history from Oct 2025)</h4>
        <p className="text-xs text-gray-500">Header: <code>period_type,period_key,gmvCofunded,grossRevenue,gmv,views,eukaMessages</code> (grossRevenue, gmv, views, eukaMessages only for history Euka cannot reach). period_type is week, month or month_check; period_key is the Sunday date for a week or YYYY-MM. A blank cell means no data and is skipped, never stored as 0.</p>
        <input type="file" accept=".csv,text/csv" onChange={async e => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()) }} className="text-xs" />
        <textarea className={`${input} font-mono h-24`} value={csv} onChange={e => setCsv(e.target.value)} placeholder="period_type,period_key,gmvCofunded,grossRevenue,gmv&#10;month,2025-10,13500,12345.67,13000" />
        <div className="flex gap-2">
          <button onClick={() => runImport(true)} disabled={busy || !csv.trim() || !name.trim()} className="text-sm border border-gray-200 px-4 py-2 rounded-xl disabled:opacity-40">Validate only</button>
          <button onClick={() => runImport(false)} disabled={busy || !csv.trim() || !name.trim()} className="text-sm bg-gray-900 text-white px-4 py-2 rounded-xl disabled:opacity-40">Import</button>
        </div>
      </div>
      {msg && <p className={`text-xs ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>}

      {entries.length > 0 && (
        <div className="border-t border-gray-100 pt-5">
          <h4 className="text-sm font-semibold text-gray-900 mb-2">Entered values ({entries.length})</h4>
          <div className="max-h-64 overflow-y-auto"><table className="w-full text-xs"><thead><tr className="text-gray-400 text-left"><th className="py-1">Period</th><th>Line</th><th>Value</th><th>By</th><th>When</th><th /></tr></thead>
            <tbody>{entries.map(e => (
              <tr key={`${e.period_type}${e.period_key}${e.line}`} className="border-t border-gray-50"><td className="py-1">{e.period_type} {e.period_key}</td><td>{e.line}</td><td className="tabular-nums">{Number(e.value).toLocaleString('en-US')}</td><td>{e.entered_by}</td><td>{String(e.entered_at ?? '').slice(0, 16).replace('T', ' ')}</td><td><button onClick={() => del(e)} className="text-red-500">delete</button></td></tr>))}</tbody></table></div>
        </div>
      )}
    </div>
  )
}
