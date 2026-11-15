import { NextRequest, NextResponse } from 'next/server'
import { saveReportCore } from '@/lib/saveReport'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let report: any
  try {
    report = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON — could not parse' }, { status: 400 })
  }

  return saveReportCore(report)
}
