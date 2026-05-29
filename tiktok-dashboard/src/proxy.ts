import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const secret = new TextEncoder().encode(process.env.AUTH_SECRET!)
const PUBLIC = ['/login', '/api/auth']

// Routes that require full admin auth — view-only users are redirected to dashboard
const ADMIN_ROUTES = ['/admin', '/api/admin', '/api/save-report', '/api/generate-report']

export default async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname
  if (PUBLIC.some(p => path.startsWith(p))) return NextResponse.next()

  const authToken = req.cookies.get('rl-auth')?.value
  const viewToken = req.cookies.get('rl-view')?.value

  const isAdminRoute = ADMIN_ROUTES.some(p => path.startsWith(p))

  if (isAdminRoute) {
    if (!authToken) {
      return NextResponse.redirect(new URL(viewToken ? '/dashboard' : '/login', req.url))
    }
    try {
      await jwtVerify(authToken, secret)
      return NextResponse.next()
    } catch {
      return NextResponse.redirect(new URL('/login', req.url))
    }
  }

  // All other routes: allow view-only cookie OR valid admin JWT
  if (viewToken) return NextResponse.next()

  if (!authToken) return NextResponse.redirect(new URL('/login', req.url))
  try {
    await jwtVerify(authToken, secret)
    return NextResponse.next()
  } catch {
    return NextResponse.redirect(new URL('/login', req.url))
  }
}

export const config = { matcher: ['/((?!_next|favicon.ico).*)'] }
