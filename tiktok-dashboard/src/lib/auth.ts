import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'

const secret = new TextEncoder().encode(process.env.AUTH_SECRET!)

export async function createToken() {
  return new SignJWT({ auth: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(secret)
}

export async function verifyToken(token: string) {
  try {
    await jwtVerify(token, secret)
    return true
  } catch {
    return false
  }
}

export async function isAuthenticated() {
  const cookieStore = await cookies()
  const token = cookieStore.get('rl-auth')?.value
  if (!token) return false
  return verifyToken(token)
}
