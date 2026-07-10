import Link from 'next/link'
import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'

export const revalidate = 60

export default async function MonthlyReportsPage() {
  const cookieStore = await cookies()
  const isViewOnly = !!cookieStore.get('rl-view') && !cookieStore.get('rl-auth')

  const { data: allReports } = await supabase
    .from('weekly_reports')
    .select('report_date, label, data_window, created_at, d30')
    .order('report_date', { ascending: false })

  const reports = (allReports ?? []).filter(r => (r.d30 as any)?.reportType === 'monthly')

  const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
  const fmtN = (n: number) => Math.round(n).toLocaleString('en-US')

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Ruff Liners · TikTok Shop</h1>
            <p className="text-sm text-gray-500">TikTok Affiliate Dashboard</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="text-xs text-gray-600 border border-gray-200 px-3 py-1.5 rounded-full font-medium hover:bg-gray-50 transition-colors"
            >
              Live 30 Day
            </Link>
            <Link
              href="/dashboard/reports"
              className="text-xs text-gray-600 border border-gray-200 px-3 py-1.5 rounded-full font-medium hover:bg-gray-50 transition-colors"
            >
              Weekly Reports
            </Link>
            <Link
              href="/dashboard/reports/monthly"
              className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded-full font-medium"
            >
              Monthly Reports
            </Link>
            {!isViewOnly && (
              <>
                <Link href="/admin?tab=manage" className="text-xs text-gray-500 px-3 py-1.5 rounded-full font-medium hover:bg-gray-100 transition-colors border border-gray-200">
                  Manage
                </Link>
                <Link href="/admin" className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded-full font-medium hover:bg-gray-700 transition-colors">
                  + New Report
                </Link>
              </>
            )}
            <a href="/api/auth/logout" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              Sign out
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 lg:px-10 py-8">
        <div className="mb-6">
          <h2 className="text-base font-semibold text-gray-900">Monthly Reports</h2>
          <p className="text-sm text-gray-400 mt-0.5">{reports.length} reports saved</p>
        </div>

        {!reports.length ? (
          <p className="text-center text-gray-400 py-16">
            No monthly reports saved yet. Generate one from Admin → select &quot;Monthly report&quot;.
          </p>
        ) : (
          <div className="space-y-3">
            {reports.map(r => {
              const d30 = r.d30 as any
              const gmv = d30?.gmv ?? 0
              const pct = d30?.gmvPct ?? 0
              const videos = d30?.videos ?? null
              const videosPct = d30?.videosPct ?? null
              const creators = d30?.creators ?? null
              const monthProgress: number = d30?.monthProgress ?? 1
              const inProgress = monthProgress < 1
              const goals = d30?.goals
              const gmvTarget: number | null = goals?.monthlyGmvTarget ?? null
              const projGmv = monthProgress > 0 ? gmv / monthProgress : gmv
              const gmvTargetStatus = gmvTarget && gmvTarget > 0
                ? (projGmv / gmvTarget >= 0.9 ? 'on' : projGmv / gmvTarget >= 0.7 ? 'risk' : 'off')
                : null
              return (
                <Link key={r.report_date} href={`/dashboard/${r.report_date}`}
                  className="block bg-white rounded-xl border border-gray-100 px-6 py-4 hover:border-gray-300 hover:shadow-sm transition-all group">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="font-medium text-gray-900">{r.label}</span>
                        {inProgress && (
                          <span className="text-[10px] font-semibold bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full uppercase tracking-wide">
                            In progress · {Math.round(monthProgress * 100)}%
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-400 mt-0.5">
                        {r.data_window} · saved {format(new Date(r.created_at), 'MMM d, yyyy h:mm a')}
                      </p>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Month GMV</p>
                        <div className="flex items-start gap-5">
                          <div>
                            <p className="text-xl font-semibold text-gray-900">{fmt$(gmv)}</p>
                            <p className={`text-xs font-medium ${pct >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                              {pct >= 0 ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}% vs prior month
                            </p>
                          </div>
                          {videos != null && (
                            <div className="hidden sm:block">
                              <p className="text-sm font-semibold text-gray-900">{fmtN(videos)}</p>
                              {videosPct != null ? (
                                <p className={`text-xs font-medium ${videosPct >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                  {videosPct >= 0 ? '↑' : '↓'} {Math.abs(videosPct).toFixed(1)}% videos
                                </p>
                              ) : <p className="text-xs text-gray-400">videos</p>}
                            </div>
                          )}
                          {creators != null && (
                            <div className="hidden md:block">
                              <p className="text-sm font-semibold text-gray-900">{fmtN(creators)}</p>
                              <p className="text-xs text-gray-400">creators</p>
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="text-gray-300 group-hover:text-gray-500 transition-colors self-center">→</span>
                    </div>
                  </div>
                  {gmvTarget && gmvTargetStatus && (() => {
                    const mtdR  = Math.min((gmv     / gmvTarget) * 100, 100)
                    const projR = Math.min((projGmv / gmvTarget) * 100, 100)
                    const solid  = gmvTargetStatus === 'on' ? 'bg-green-500'  : gmvTargetStatus === 'risk' ? 'bg-amber-400' : 'bg-red-400'
                    const light  = gmvTargetStatus === 'on' ? 'bg-green-200'  : gmvTargetStatus === 'risk' ? 'bg-amber-200' : 'bg-red-200'
                    const color  = gmvTargetStatus === 'on' ? 'text-green-700': gmvTargetStatus === 'risk' ? 'text-amber-700': 'text-red-700'
                    const badge  = gmvTargetStatus === 'on' ? (inProgress ? 'On Track' : 'Hit') : gmvTargetStatus === 'risk' ? (inProgress ? 'At Risk' : 'Near Miss') : (inProgress ? 'Off Track' : 'Missed')
                    return (
                      <div className="mt-3 pt-3 border-t border-gray-50">
                        <div className="flex items-center justify-between mb-1.5 text-xs text-gray-500">
                          <span>
                            Monthly GMV goal — <span className="font-semibold text-gray-800">{fmt$(gmv)}</span>
                            {inProgress && <>{' → '}Proj <span className="font-semibold text-gray-800">{fmt$(projGmv)}</span></>}
                            <span className="text-gray-400"> / {fmt$(gmvTarget)}</span>
                          </span>
                          <span className={`font-semibold ${color}`}>{badge}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden relative">
                          <div className={`absolute inset-y-0 left-0 rounded-full ${light}`} style={{ width: `${projR}%` }} />
                          <div className={`absolute inset-y-0 left-0 rounded-full ${solid}`} style={{ width: `${mtdR}%` }} />
                        </div>
                      </div>
                    )
                  })()}
                </Link>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
