import { NextRequest, NextResponse } from 'next/server'
import { buildTodo } from '@/lib/scorecard'
import { loadLatestScorecard } from '@/lib/scorecardStore'

export const dynamic = 'force-dynamic'

// Admin only. Lists the Seller Center values still missing, so a person or Claude in Chrome enters exactly those and nothing else.
export async function GET(req: NextRequest) {
  if (!req.cookies.get('rl-auth')?.value) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const loaded = await loadLatestScorecard().catch(() => null)
  if (!loaded) return NextResponse.json({ error: 'No scorecard has been published yet' }, { status: 404 })
  return NextResponse.json(buildTodo(loaded.scorecard))
}
