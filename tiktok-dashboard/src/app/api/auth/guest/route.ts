import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/dashboard', req.url))
  res.cookies.set('rl-view', '1', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })
  return res
}
