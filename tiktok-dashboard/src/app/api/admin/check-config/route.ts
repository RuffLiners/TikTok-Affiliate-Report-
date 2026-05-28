import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('rl-auth')?.value
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const supabase = supabaseAdmin()
  const { data } = await supabase
    .from('app_config')
    .select('key, value')
    .in('key', ['anthropic_api_key'])

  const dbKey = data?.find(r => r.key === 'anthropic_api_key')?.value as string | undefined

  const hasAnthropicKey = !!(dbKey || process.env.ANTHROPIC_API_KEY)
  const hasEukaMcpUrl   = !!process.env.EUKA_MCP_URL
  const hasEukaStoreId  = !!process.env.EUKA_STORE_ID

  const maskedKey = dbKey
    ? dbKey.slice(0, 10) + '···' + dbKey.slice(-4)
    : process.env.ANTHROPIC_API_KEY
      ? 'sk-ant-···  (env)'
      : null

  return NextResponse.json({
    ready: hasAnthropicKey && hasEukaMcpUrl && hasEukaStoreId,
    anthropicKey: { set: hasAnthropicKey, source: dbKey ? 'db' : process.env.ANTHROPIC_API_KEY ? 'env' : 'none', masked: maskedKey },
    eukaMcpUrl:  { set: hasEukaMcpUrl },
    eukaStoreId: { set: hasEukaStoreId },
  })
}
