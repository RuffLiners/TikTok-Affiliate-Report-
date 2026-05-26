import Link from 'next/link'
import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabase'
import { format } from 'date-fns'

export const revalidate = 60

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function getMonthProgress(reportDate: string) {
  const d = new Date(reportDate + 'T00:00:00')
  const dayOfMonth = d.getDate()
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return { dayOfMonth, daysInMonth, pct: dayOfMonth / daysInMonth }
}

function weekRange(label: string | undefined, reportDate: string): string {
  if (!label) return ''
  const [mStr, dStr] = label.split('/')
  const m = parseInt(mStr, 10)
  const d = parseInt(dStr, 10)
  if (!m || !d) return ''
  const year = parseInt(reportDate.slice(0, 4), 10)
  const monthName = MONTH_NAMES[m - 1]
  const endDay = d + 6
  const startDate = new Date(year, m - 1, d)
  const endDate = new Date(year, m - 1, endDay)
  if (endDate.getMonth() !== startDate.getMonth()) {
    const endMonth = MONTH_NAMES[endDate.getMonth()]
    return `${monthName} ${d}–${endMonth} ${endDate.getDate()}`
  }
  return `${monthName} ${d}–${endDay}`
}

function pctChange(curr: number, prev: number): number | null {
  if (!prev) return null
  return ((curr - prev) / prev) * 100
}

export default async function DashboardPage() {
  const cookieStore = await cookies()
  const isViewOnly = !!cookieStore.get('rl-view') && !cookieStore.get('rl-auth')

  const [{ data: reports }, { data: goalsConfig }] = await Promise.all([
    supabase
      .from('weekly_reports')
      .select('report_date, label, data_window, created_at, d30, weekly_charts, monthly_charts')
      .order('report_date', { ascending: false }),
    supabaseAdmin()
      .from('app_config').select('value').eq('key', 'goals').single()
  ])
  const goals = goalsConfig ? (() => { try { return JSON.parse(goalsConfig.value) } catch { return null } })() : null

  const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
  const fmtN = (n: number) => Math.round(n).toLocaleString('en-US')

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Ruff Liners · TikTok Shop</h1>
            <p className="text-sm text-gray-500">Weekly report archive</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs bg-green-50 text-green-700 px-3 py-1 rounded-full font-medium">
              {reports?.length ?? 0} reports saved
            </span>
            {!isViewOnly && (
              <>
                <Link href="/admin?tab=manage" className="text-xs text-gray-500 px-3 py-1 rounded-full font-medium hover:bg-gray-100 transition-colors border border-gray-200">
                  Manage
                </Link>
                <Link href="/admin" className="text-xs bg-gray-900 text-white px-3 py-1 rounded-full font-medium hover:bg-gray-700 transition-colors">
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

      <main className="max-w-5xl mx-auto px-6 py-8">
        {!reports?.length ? (
          <p className="text-center text-gray-400 py-16">No reports saved yet. Run the weekly script to add the first report.</p>
        ) : (
          <div className="space-y-3">
            {reports.map(r => {
              const d30 = r.d30 as { gmv?: number; gmvPct?: number; videos?: number; videosPct?: number }
              const gmv = d30?.gmv ?? 0
              const pct = d30?.gmvPct ?? 0
              const d30Videos = d30?.videos ?? null
              const d30VideosPct = d30?.videosPct ?? null
              const wc = r.weekly_charts as { gmv?: number[]; vid?: number[]; labels?: string[] } | null
              const wGmv = wc?.gmv?.at(-1) ?? null
              const wGmvPrev = wc?.gmv?.at(-2) ?? null
              const wVid = wc?.vid?.at(-1) ?? null
              const wVidPrev = wc?.vid?.at(-2) ?? null
              const wGmvPct = wGmv != null && wGmvPrev != null ? pctChange(wGmv, wGmvPrev) : null
              const wVidPct = wVid != null && wVidPrev != null ? pctChange(wVid, wVidPrev) : null
              const weekLabel = wc?.labels?.at(-1)
              const weekStr = weekRange(weekLabel, r.report_date)
              // Monthly GMV target strip
              const mc = r.monthly_charts as { gmv?: number[] } | null
              const mtdGmv = mc?.gmv?.at(-1) ?? 0
              const { pct: monthPct } = getMonthProgress(r.report_date)
              const projGmv = monthPct > 0 ? mtdGmv / monthPct : mtdGmv
              const gmvTarget: number | null = goals?.monthlyGmvTarget ?? null
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
                        {weekStr && <span className="text-xs text-gray-400">{weekStr}</span>}
                      </div>
                      <p className="text-sm text-gray-400 mt-0.5">
                        Saved {format(new Date(r.created_at), 'MMM d, yyyy h:mm a')}
                      </p>
                    </div>
                    <div className="flex items-center gap-6">
                      {/* Weekly group */}
                      {(wGmv != null || wVid != null) && (
                        <div className="hidden sm:block text-right">
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Weekly</p>
                          <div className="flex items-start gap-5">
                            {wGmv != null && (
                              <div>
                                <p className="text-sm font-semibold text-gray-900">{fmt$(wGmv)}</p>
                                {wGmvPct != null ? (
                                  <p className={`text-xs font-medium ${wGmvPct >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                    {wGmvPct >= 0 ? '↑' : '↓'} {Math.abs(wGmvPct).toFixed(1)}%
                                  </p>
                                ) : (
                                  <p className="text-xs text-gray-400">GMV</p>
                                )}
                              </div>
                            )}
                            {wVid != null && (
                              <div>
                                <p className="text-sm font-semibold text-gray-900">{fmtN(wVid)}</p>
                                {wVidPct != null ? (
                                  <p className={`text-xs font-medium ${wVidPct >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                    {wVidPct >= 0 ? '↑' : '↓'} {Math.abs(wVidPct).toFixed(1)}%
                                  </p>
                                ) : (
                                  <p className="text-xs text-gray-400">videos</p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {/* Last 30D group */}
                      <div className="text-right">
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Last 30D</p>
                        <div className="flex items-start gap-5">
                          <div>
                            <p className="text-xl font-semibold text-gray-900">{fmt$(gmv)}</p>
                            <p className={`text-xs font-medium ${pct >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                              {pct >= 0 ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}% vs prior
                            </p>
                          </div>
                          {d30Videos != null && (
                            <div className="hidden sm:block">
                              <p className="text-sm font-semibold text-gray-900">{fmtN(d30Videos)}</p>
                              {d30VideosPct != null ? (
                                <p className={`text-xs font-medium ${d30VideosPct >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                  {d30VideosPct >= 0 ? '↑' : '↓'} {Math.abs(d30VideosPct).toFixed(1)}% vs prior
                                </p>
                              ) : (
                                <p className="text-xs text-gray-400">videos</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="text-gray-300 group-hover:text-gray-500 transition-colors self-center">→</span>
                    </div>
                  </div>
                  {gmvTarget && gmvTargetStatus && (() => {
                    const mtdR  = Math.min((mtdGmv  / gmvTarget) * 100, 100)
                    const projR = Math.min((projGmv / gmvTarget) * 100, 100)
                    const solid  = gmvTargetStatus === 'on' ? 'bg-green-500'  : gmvTargetStatus === 'risk' ? 'bg-amber-400' : 'bg-red-400'
                    const light  = gmvTargetStatus === 'on' ? 'bg-green-200'  : gmvTargetStatus === 'risk' ? 'bg-amber-200' : 'bg-red-200'
                    const color  = gmvTargetStatus === 'on' ? 'text-green-700': gmvTargetStatus === 'risk' ? 'text-amber-700': 'text-red-700'
                    const badge  = gmvTargetStatus === 'on' ? 'On Track'      : gmvTargetStatus === 'risk' ? 'At Risk'      : 'Off Track'
                    return (
                      <div className="mt-3 pt-3 border-t border-gray-50">
                        <div className="flex items-center justify-between mb-1.5 text-xs text-gray-500">
                          <span>
                            Monthly GMV — MTD <span className="font-semibold text-gray-800">{fmt$(mtdGmv)}</span>
                            {' → '}Proj <span className="font-semibold text-gray-800">{fmt$(projGmv)}</span>
                            <span className="text-gray-400"> / {fmt$(gmvTarget)}</span>
                            <span className="text-gray-400 ml-1">({Math.round(monthPct * 100)}% thru month)</span>
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
