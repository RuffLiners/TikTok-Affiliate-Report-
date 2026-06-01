import Link from 'next/link'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'
import { LiveDashboard } from '@/components/LiveDashboard'
import { WeeklyReport } from '@/lib/types'

export const revalidate = 0

export default async function DashboardPage() {
  const cookieStore = await cookies()
  const isViewOnly = !!cookieStore.get('rl-view') && !cookieStore.get('rl-auth')

  const [{ data: liveConfig }, { data: goalsConfig }] = await Promise.all([
    supabaseAdmin().from('app_config').select('value').eq('key', 'live_report').maybeSingle(),
    supabaseAdmin().from('app_config').select('value').eq('key', 'goals').single()
  ])
  const goals = goalsConfig ? (() => { try { return JSON.parse(goalsConfig.value) } catch { return null } })() : null
  const latestReport = liveConfig ? (() => { try { return JSON.parse(liveConfig.value) as WeeklyReport } catch { return undefined } })() : undefined

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
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
              Weekly Reports Page
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

      <main className="max-w-5xl mx-auto px-6 py-8">
        <LiveDashboard report={latestReport ?? null} goals={goals} />
      </main>
    </div>
  )
}
