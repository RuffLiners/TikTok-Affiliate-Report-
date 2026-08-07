import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  // Supabase Vercel integration sets SUPABASE_SERVICE_ROLE_KEY; some setups use SUPABASE_SERVICE_KEY
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error(`Supabase admin env vars missing: URL=${!!url} KEY=${!!key}`)
  return createClient(url, key)
}
