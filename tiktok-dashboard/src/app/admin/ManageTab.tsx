'use client'
import { useEffect, useState } from 'react'

interface ReportMeta {
  report_date: string
  label: string
  data_window: string
  d30_gmv: number
}

const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export function ManageTab() {
  const [reports, setReports]           = useState<ReportMeta[]>([])
  const [loading, setLoading]           = useState(true)

  // Replace state
  const [replacingDate, setReplacingDate] = useState<string | null>(null)
  const [replaceJson, setReplaceJson]     = useState('')
  const [replaceStatus, setReplaceStatus] = useState<'idle'|'loading'|'saving'|'success'|'error'>('idle')
  const [replaceError, setReplaceError]   = useState('')

  // Delete state
  const [deletingDate, setDeletingDate] = useState<string | null>(null)
  const [deletePassword, setDeletePw]   = useState('')
  const [deleteStatus, setDeleteStatus] = useState<'idle'|'deleting'|'error'>('idle')
  const [deleteError, setDeleteError]   = useState('')

  // Super admin password state
  const [superPwSet, setSuperPwSet]         = useState<boolean | null>(null)
  const [currentPw, setCurrentPw]           = useState('')
  const [newPw, setNewPw]                   = useState('')
  const [confirmPw, setConfirmPw]           = useState('')
  const [pwStatus, setPwStatus]             = useState<'idle'|'saving'|'success'|'error'>('idle')
  const [pwError, setPwError]               = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/reports').then(r => r.json()),
      fetch('/api/admin/super-password').then(r => r.json())
    ]).then(([rpts, spw]) => {
      setReports(rpts || [])
      setSuperPwSet(spw?.set ?? false)
      setLoading(false)
    })
  }, [])

  // ── Replace ──────────────────────────────────────────────

  async function startReplace(date: string) {
    setReplacingDate(date)
    setReplaceStatus('loading')
    setReplaceJson('')
    setReplaceError('')

    const res = await fetch(`/api/report?date=${date}`)
    if (!res.ok) { setReplaceStatus('error'); setReplaceError('Failed to load report data.'); return }

    const data = await res.json()
    // Format as the JSON the paste workflow expects
    const formatted = {
      meta: { reportDate: data.report_date, label: data.label, dataWindow: data.data_window },
      d30: data.d30,
      weeklyCharts: data.weekly_charts,
      monthlyCharts: data.monthly_charts,
      tables: data.tables,
      analysis: data.analysis ?? { d30: '', weekly: '', monthly: '' }
    }
    setReplaceJson(JSON.stringify(formatted, null, 2))
    setReplaceStatus('idle')
  }

  async function saveReplace() {
    setReplaceStatus('saving')
    setReplaceError('')

    let parsed: any
    try { parsed = JSON.parse(replaceJson) }
    catch { setReplaceStatus('error'); setReplaceError('Invalid JSON.'); return }

    const res = await fetch('/api/save-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      setReplaceStatus('error')
      setReplaceError(data.error || 'Save failed.')
    } else {
      setReplaceStatus('success')
      setTimeout(() => { setReplacingDate(null); setReplaceStatus('idle') }, 1500)
    }
  }

  // ── Delete ───────────────────────────────────────────────

  async function confirmDelete(date: string) {
    setDeleteStatus('deleting')
    setDeleteError('')

    const res = await fetch('/api/admin/delete-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportDate: date, password: deletePassword })
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      setDeleteStatus('error')
      setDeleteError(data.error || 'Delete failed.')
    } else {
      setReports(prev => prev.filter(r => r.report_date !== date))
      setDeletingDate(null)
      setDeletePw('')
      setDeleteStatus('idle')
    }
  }

  // ── Super admin password ─────────────────────────────────

  async function savePassword() {
    if (newPw !== confirmPw) { setPwError('Passwords do not match.'); return }
    if (newPw.length < 6) { setPwError('Password must be at least 6 characters.'); return }
    setPwStatus('saving')
    setPwError('')

    const res = await fetch('/api/admin/super-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: newPw, currentPassword: currentPw })
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      setPwStatus('error')
      setPwError(data.error || 'Failed to save password.')
    } else {
      setPwStatus('success')
      setSuperPwSet(true)
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
      setTimeout(() => setPwStatus('idle'), 2000)
    }
  }

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>

  return (
    <div className="space-y-6">

      {/* ── Reports list ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-50">
          <h2 className="font-semibold text-gray-900">Reports</h2>
          <p className="text-xs text-gray-400 mt-0.5">{reports.length} saved</p>
        </div>

        {reports.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No reports yet.</p>
        )}

        <div className="divide-y divide-gray-50">
          {reports.map(r => (
            <div key={r.report_date}>
              {/* Row */}
              <div className="px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{r.label}</p>
                  <p className="text-xs text-gray-400">{r.data_window}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-gray-700">{fmt$(r.d30_gmv)}</span>
                  <button
                    onClick={() => replacingDate === r.report_date ? setReplacingDate(null) : startReplace(r.report_date)}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2.5 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                  >
                    {replacingDate === r.report_date ? 'Cancel' : 'Replace'}
                  </button>
                  <button
                    onClick={() => {
                      if (deletingDate === r.report_date) { setDeletingDate(null); setDeletePw(''); setDeleteStatus('idle') }
                      else { setDeletingDate(r.report_date); setDeletePw(''); setDeleteStatus('idle') }
                    }}
                    className="text-xs text-red-500 hover:text-red-700 font-medium px-2.5 py-1 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    {deletingDate === r.report_date ? 'Cancel' : 'Delete'}
                  </button>
                </div>
              </div>

              {/* Replace panel */}
              {replacingDate === r.report_date && (
                <div className="px-6 pb-5 bg-blue-50 border-t border-blue-100">
                  <p className="text-xs font-medium text-blue-700 mt-4 mb-2">
                    Edit the JSON below and click Save to replace this report.
                  </p>
                  {replaceStatus === 'loading' && <p className="text-xs text-gray-400 py-4 text-center">Loading report data…</p>}
                  {replaceStatus !== 'loading' && (
                    <>
                      <textarea
                        value={replaceJson}
                        onChange={e => { setReplaceJson(e.target.value); setReplaceStatus('idle') }}
                        className="w-full h-56 border border-blue-200 rounded-xl px-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white resize-none"
                      />
                      {replaceStatus === 'error' && (
                        <p className="text-xs text-red-600 mt-1">{replaceError}</p>
                      )}
                      {replaceStatus === 'success' && (
                        <p className="text-xs text-green-600 mt-1">✓ Saved successfully</p>
                      )}
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={saveReplace}
                          disabled={replaceStatus === 'saving'}
                          className="bg-gray-900 text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
                        >
                          {replaceStatus === 'saving' ? 'Saving…' : 'Save Changes'}
                        </button>
                        <button
                          onClick={() => setReplacingDate(null)}
                          className="border border-gray-200 text-xs text-gray-500 px-4 py-2 rounded-lg hover:bg-white transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Delete panel */}
              {deletingDate === r.report_date && (
                <div className="px-6 pb-5 bg-red-50 border-t border-red-100">
                  <p className="text-xs font-medium text-red-700 mt-4 mb-2">
                    Enter your super admin password to permanently delete <strong>{r.label}</strong>.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={deletePassword}
                      onChange={e => { setDeletePw(e.target.value); setDeleteStatus('idle'); setDeleteError('') }}
                      placeholder="Super admin password"
                      className="flex-1 border border-red-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
                      onKeyDown={e => e.key === 'Enter' && deletePassword && confirmDelete(r.report_date)}
                    />
                    <button
                      onClick={() => confirmDelete(r.report_date)}
                      disabled={!deletePassword || deleteStatus === 'deleting'}
                      className="bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {deleteStatus === 'deleting' ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                  {deleteStatus === 'error' && (
                    <p className="text-xs text-red-600 mt-1.5">{deleteError}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Super admin password ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="font-semibold text-gray-900 mb-1">Security</h2>
        <p className="text-xs text-gray-400 mb-4">
          {superPwSet
            ? 'The super admin password is set. Change it below.'
            : 'No super admin password is set yet. Create one to enable report deletion.'}
        </p>

        <div className="space-y-2.5 max-w-sm">
          {superPwSet && (
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Current password</label>
              <input
                type="password"
                value={currentPw}
                onChange={e => { setCurrentPw(e.target.value); setPwStatus('idle'); setPwError('') }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              {superPwSet ? 'New password' : 'Set super admin password'}
            </label>
            <input
              type="password"
              value={newPw}
              onChange={e => { setNewPw(e.target.value); setPwStatus('idle'); setPwError('') }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Confirm password</label>
            <input
              type="password"
              value={confirmPw}
              onChange={e => { setConfirmPw(e.target.value); setPwStatus('idle'); setPwError('') }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          {pwError && <p className="text-xs text-red-600">{pwError}</p>}
          {pwStatus === 'success' && <p className="text-xs text-green-600">✓ Password saved</p>}
          <button
            onClick={savePassword}
            disabled={!newPw || !confirmPw || pwStatus === 'saving'}
            className="bg-gray-900 text-white text-sm font-medium px-5 py-2 rounded-xl hover:bg-gray-800 disabled:opacity-40 transition-colors"
          >
            {pwStatus === 'saving' ? 'Saving…' : superPwSet ? 'Change Password' : 'Set Password'}
          </button>
        </div>
      </div>

    </div>
  )
}
