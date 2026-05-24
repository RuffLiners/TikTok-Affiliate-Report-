'use client'
import { useEffect, useState } from 'react'

interface ReportMeta {
  report_date: string
  label: string
  data_window: string
  d30_gmv: number
}

type ModalState =
  | { type: 'confirm-edit';    date: string; label: string }
  | { type: 'confirm-replace'; date: string; label: string }
  | { type: 'delete';          date: string; label: string }
  | null

const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export function ManageTab() {
  const [reports, setReports]   = useState<ReportMeta[]>([])
  const [loading, setLoading]   = useState(true)

  // Edit analysis
  const [editingDate, setEditingDate]       = useState<string | null>(null)
  const [editAnalysis, setEditAnalysis]     = useState({ d30: '', weekly: '', monthly: '' })
  const [editFullReport, setEditFullReport] = useState<any>(null)
  const [editStatus, setEditStatus]         = useState<'idle'|'loading'|'saving'|'success'|'error'>('idle')
  const [editError, setEditError]           = useState('')

  // Replace (raw JSON)
  const [replacingDate, setReplacingDate]   = useState<string | null>(null)
  const [replaceJson, setReplaceJson]       = useState('')
  const [replaceStatus, setReplaceStatus]   = useState<'idle'|'loading'|'saving'|'success'|'error'>('idle')
  const [replaceError, setReplaceError]     = useState('')

  // Delete
  const [deletePassword, setDeletePw]       = useState('')
  const [deleteStatus, setDeleteStatus]     = useState<'idle'|'deleting'|'error'>('idle')
  const [deleteError, setDeleteError]       = useState('')

  // Super admin password
  const [superPwSet, setSuperPwSet]         = useState<boolean | null>(null)
  const [currentPw, setCurrentPw]           = useState('')
  const [newPw, setNewPw]                   = useState('')
  const [confirmPw, setConfirmPw]           = useState('')
  const [pwStatus, setPwStatus]             = useState<'idle'|'saving'|'success'|'error'>('idle')
  const [pwError, setPwError]               = useState('')

  // Modal
  const [modal, setModal] = useState<ModalState>(null)

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

  function closeModal() {
    setModal(null)
    setDeletePw('')
    setDeleteStatus('idle')
    setDeleteError('')
  }

  // ── Edit Analysis ────────────────────────────────────────

  async function startEdit(date: string) {
    if (editingDate === date) { setEditingDate(null); return }
    setEditingDate(date)
    setReplacingDate(null)
    setEditStatus('loading')
    setEditError('')

    const res = await fetch(`/api/report?date=${date}`)
    if (!res.ok) { setEditStatus('error'); setEditError('Failed to load report.'); return }

    const data = await res.json()
    setEditFullReport(data)
    setEditAnalysis({
      d30:     data.analysis?.d30     ?? '',
      weekly:  data.analysis?.weekly  ?? '',
      monthly: data.analysis?.monthly ?? '',
    })
    setEditStatus('idle')
  }

  async function doSaveEdit() {
    setModal(null)
    setEditStatus('saving')
    setEditError('')

    const data = editFullReport
    const payload = {
      meta:          { reportDate: data.report_date, label: data.label, dataWindow: data.data_window },
      d30:           data.d30,
      weeklyCharts:  data.weekly_charts,
      monthlyCharts: data.monthly_charts,
      tables:        data.tables,
      analysis:      editAnalysis,
    }

    const res = await fetch('/api/save-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const result = await res.json().catch(() => ({}))

    if (!res.ok) {
      setEditStatus('error')
      setEditError(result.error || 'Save failed.')
    } else {
      setEditStatus('success')
      setTimeout(() => { setEditingDate(null); setEditStatus('idle') }, 1500)
    }
  }

  // ── Replace (raw JSON) ────────────────────────────────────

  async function startReplace(date: string) {
    if (replacingDate === date) { setReplacingDate(null); return }
    setReplacingDate(date)
    setEditingDate(null)
    setReplaceStatus('loading')
    setReplaceJson('')
    setReplaceError('')

    const res = await fetch(`/api/report?date=${date}`)
    if (!res.ok) { setReplaceStatus('error'); setReplaceError('Failed to load report data.'); return }

    const data = await res.json()
    setReplaceJson(JSON.stringify({
      meta:          { reportDate: data.report_date, label: data.label, dataWindow: data.data_window },
      d30:           data.d30,
      weeklyCharts:  data.weekly_charts,
      monthlyCharts: data.monthly_charts,
      tables:        data.tables,
      analysis:      data.analysis ?? { d30: '', weekly: '', monthly: '' },
    }, null, 2))
    setReplaceStatus('idle')
  }

  async function doSaveReplace() {
    setModal(null)
    setReplaceStatus('saving')
    setReplaceError('')

    let parsed: any
    try { parsed = JSON.parse(replaceJson) }
    catch { setReplaceStatus('error'); setReplaceError('Invalid JSON.'); return }

    const res = await fetch('/api/save-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
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

  async function doDelete(date: string) {
    setDeleteStatus('deleting')
    setDeleteError('')

    const res = await fetch('/api/admin/delete-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportDate: date, password: deletePassword }),
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      setDeleteStatus('error')
      setDeleteError(data.error || 'Delete failed.')
    } else {
      setReports(prev => prev.filter(r => r.report_date !== date))
      closeModal()
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
      body: JSON.stringify({ newPassword: newPw, currentPassword: currentPw }),
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

      {/* ── Modal overlay ── */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4"
            onClick={e => e.stopPropagation()}
          >

            {modal.type === 'confirm-edit' && (
              <>
                <h3 className="font-semibold text-gray-900 mb-1">Save analysis changes?</h3>
                <p className="text-sm text-gray-500 mb-6">
                  This will update the analysis sections for <strong>{modal.label}</strong>.
                </p>
                <div className="flex gap-2 justify-end">
                  <button onClick={closeModal} className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                  <button onClick={doSaveEdit} className="text-sm px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition-colors">
                    Save Changes
                  </button>
                </div>
              </>
            )}

            {modal.type === 'confirm-replace' && (
              <>
                <h3 className="font-semibold text-gray-900 mb-1">Replace report data?</h3>
                <p className="text-sm text-gray-500 mb-6">
                  All data for <strong>{modal.label}</strong> will be overwritten with the edited JSON. This cannot be undone.
                </p>
                <div className="flex gap-2 justify-end">
                  <button onClick={closeModal} className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                  <button onClick={doSaveReplace} className="text-sm px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition-colors">
                    Replace
                  </button>
                </div>
              </>
            )}

            {modal.type === 'delete' && (
              <>
                <h3 className="font-semibold text-gray-900 mb-1">Delete this report?</h3>
                <p className="text-sm text-gray-500 mb-4">
                  <strong>{modal.label}</strong> will be permanently deleted. This cannot be undone.
                </p>
                <div className="mb-5">
                  <label className="text-xs font-medium text-gray-600 block mb-1">Super admin password</label>
                  <input
                    type="password"
                    autoFocus
                    value={deletePassword}
                    onChange={e => { setDeletePw(e.target.value); setDeleteStatus('idle'); setDeleteError('') }}
                    onKeyDown={e => e.key === 'Enter' && deletePassword && doDelete(modal.date)}
                    placeholder="Enter password to confirm"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                  {deleteStatus === 'error' && (
                    <p className="text-xs text-red-600 mt-1">{deleteError}</p>
                  )}
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={closeModal} className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={() => doDelete(modal.date)}
                    disabled={!deletePassword || deleteStatus === 'deleting'}
                    className="text-sm px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {deleteStatus === 'deleting' ? 'Deleting…' : 'Delete Forever'}
                  </button>
                </div>
              </>
            )}

          </div>
        </div>
      )}

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
                    onClick={() => startEdit(r.report_date)}
                    className={`text-xs font-medium px-2.5 py-1 rounded-lg transition-colors ${
                      editingDate === r.report_date
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-blue-600 hover:text-blue-800 hover:bg-blue-50'
                    }`}
                  >
                    {editingDate === r.report_date ? 'Cancel' : 'Edit'}
                  </button>
                  <button
                    onClick={() => startReplace(r.report_date)}
                    className={`text-xs font-medium px-2.5 py-1 rounded-lg transition-colors ${
                      replacingDate === r.report_date
                        ? 'bg-orange-100 text-orange-700'
                        : 'text-orange-500 hover:text-orange-700 hover:bg-orange-50'
                    }`}
                  >
                    {replacingDate === r.report_date ? 'Cancel' : 'Replace'}
                  </button>
                  <button
                    onClick={() => setModal({ type: 'delete', date: r.report_date, label: r.label })}
                    className="text-xs text-red-500 hover:text-red-700 font-medium px-2.5 py-1 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Edit analysis panel */}
              {editingDate === r.report_date && (
                <div className="px-6 pb-6 bg-blue-50 border-t border-blue-100">
                  {editStatus === 'loading' && (
                    <p className="text-xs text-gray-400 py-4 text-center">Loading…</p>
                  )}
                  {editStatus !== 'loading' && (
                    <div className="space-y-4 pt-4">
                      {([
                        { key: 'd30',     label: '30-Day Analysis' },
                        { key: 'weekly',  label: 'Weekly Trend Analysis' },
                        { key: 'monthly', label: 'Monthly Analysis' },
                      ] as const).map(({ key, label }) => (
                        <div key={key}>
                          <label className="text-xs font-semibold text-blue-800 block mb-1">{label}</label>
                          <textarea
                            value={editAnalysis[key]}
                            onChange={e => {
                              const val = e.target.value
                              setEditAnalysis(prev => ({ ...prev, [key]: val }))
                            }}
                            rows={6}
                            className="w-full border border-blue-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white resize-y"
                          />
                        </div>
                      ))}
                      {editStatus === 'error'   && <p className="text-xs text-red-600">{editError}</p>}
                      {editStatus === 'success' && <p className="text-xs text-green-600">✓ Saved successfully</p>}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setModal({ type: 'confirm-edit', date: r.report_date, label: r.label })}
                          disabled={editStatus === 'saving'}
                          className="bg-gray-900 text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
                        >
                          {editStatus === 'saving' ? 'Saving…' : 'Save Analysis'}
                        </button>
                        <button
                          onClick={() => setEditingDate(null)}
                          className="border border-gray-200 text-xs text-gray-500 px-4 py-2 rounded-lg hover:bg-white transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Replace panel */}
              {replacingDate === r.report_date && (
                <div className="px-6 pb-5 bg-orange-50 border-t border-orange-100">
                  <p className="text-xs font-medium text-orange-700 mt-4 mb-2">
                    Edit the JSON below then click Replace — a confirmation will appear before saving.
                  </p>
                  {replaceStatus === 'loading' && (
                    <p className="text-xs text-gray-400 py-4 text-center">Loading report data…</p>
                  )}
                  {replaceStatus !== 'loading' && (
                    <>
                      <textarea
                        value={replaceJson}
                        onChange={e => { setReplaceJson(e.target.value); setReplaceStatus('idle') }}
                        className="w-full h-56 border border-orange-200 rounded-xl px-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white resize-none"
                      />
                      {replaceStatus === 'error'   && <p className="text-xs text-red-600 mt-1">{replaceError}</p>}
                      {replaceStatus === 'success' && <p className="text-xs text-green-600 mt-1">✓ Replaced successfully</p>}
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => setModal({ type: 'confirm-replace', date: r.report_date, label: r.label })}
                          disabled={replaceStatus === 'saving'}
                          className="bg-gray-900 text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
                        >
                          {replaceStatus === 'saving' ? 'Saving…' : 'Replace Report'}
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
