import Link from 'next/link'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'
import LiveDashboard from '@/components/LiveDashboard'
import { WeeklyReport } from '@/lib/types'
import { loadLatestScorecard } from '@/lib/scorecardStore'

export const revalidate = 0

export default async function DashboardPage() {
  const cookieStore = await cookies()
  const isViewOnly = !!cookieStore.get('rl-view') && !cookieStore.get('rl-auth')

  const [{ data: liveConfig }, { data: goalsConfig }] = await Promise.all([
    supabaseAdmin().from('app_config').select('value').eq('key', 'live_report').maybeSingle(),
    supabaseAdmin().from('app_config').select('value').eq('key', 'goals').single()
  ])
  const goals = goalsConfig ? (() => { try { return JSON.parse(goalsConfig.value) } catch { return null } })() : null
  const liveSnapshot = liveConfig ? (() => { try { return JSON.parse(liveConfig.value) as WeeklyReport } catch { return undefined } })() : undefined

  // The live snapshot is only rewritten by runs that pass the review gate, so a saved report that
  // was flagged NEEDS REVIEW used to leave this page on an older report with no warning. Show the
  // newest saved weekly report whenever it is newer than the snapshot, and surface its flags.
  const { data: newestWeekly } = await supabaseAdmin().from('weekly_reports')
    .select('report_date, label, data_window, d30, tables, agents, analysis')
    .not('report_date', 'like', '%-M')
    .order('report_date', { ascending: false }).limit(1).maybeSingle()
  const useSaved = !!newestWeekly && (!liveSnapshot || String(newestWeekly.report_date) > String(liveSnapshot.report_date))
  const latestReport = useSaved
    ? ({ ...newestWeekly, analysis: { d30: newestWeekly!.analysis?.d30 || newestWeekly!.analysis?.performance || '' } } as unknown as WeeklyReport)
    : liveSnapshot
  const needsReview: string[] = ((latestReport?.d30 as any)?.needsReview ?? []) as string[]
  const scorecardLoaded = await loadLatestScorecard().catch(() => null)

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
              className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded-full font-medium"
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
              className="text-xs text-gray-600 border border-gray-200 px-3 py-1.5 rounded-full font-medium hover:bg-gray-50 transition-colors"
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
        {needsReview.length > 0 && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-sm font-semibold text-amber-800">Showing {latestReport?.label ?? 'the latest report'}: flagged NEEDS REVIEW, not yet confirmed</p>
            <ul className="mt-1 text-xs text-amber-800 list-disc pl-5 space-y-0.5">{needsReview.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </div>
        )}
        <LiveDashboard report={latestReport ?? null} goals={goals} scorecard={scorecardLoaded?.scorecard ?? null} scorecardMeta={scorecardLoaded ? { publishedAt: scorecardLoaded.publishedAt, audit: scorecardLoaded.liveAudit.status } : null} />
      </main>
    </div>
  )
}
