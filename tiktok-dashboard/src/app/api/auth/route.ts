import { NextRequest, NextResponse } from 'next/server'
import { createToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { password } = await req.json()

  if (password !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const token = await createToken()
  const res = NextResponse.json({ ok: true })
  res.cookies.set('rl-auth', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7
  })
  return res
}
