import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/login', req.url))
  res.cookies.set('rl-auth', '', { maxAge: 0, path: '/' })
  res.cookies.set('rl-view', '', { maxAge: 0, path: '/' })
  return res
}
