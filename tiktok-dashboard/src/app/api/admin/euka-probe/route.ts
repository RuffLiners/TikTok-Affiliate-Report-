import { NextRequest, NextResponse } from 'next/server'
import { request as httpsRequest } from 'https'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { verifyToken } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Step 0 proof for the in-dashboard scorecard backfill. Makes one cheap Euka call two ways from Vercel:
//   (a) direct MCP client with the bearer token, as pipeline/src/euka.ts does
//   (b) through the Anthropic API MCP connector, as /api/jobs/run does
// Reports which succeed and the exact error text of any that fail. Token and key values are never returned or logged.

const TOOL = 'list_accessible_brands'
const BRAND_ID = 'b4ec897a-fb59-48e7-9320-873ea5e25155'
const DEFAULT_URL = 'https://app.euka.ai/api/mcp'

function eukaToken(): string {
  const raw = (process.env.EUKA_BEARER_TOKEN || '').trim()
  return raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw
}

/** Strip any secret that an upstream error might echo back. */
function redact(text: string, secrets: Array<string | null | undefined>): string {
  let out = String(text ?? '')
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('[redacted]')
  return out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/g, 'Bearer [redacted]').replace(/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 1200)
}

/** Expiry of the token if it is a JWT. Only the date is read; nothing else from the token is exposed. */
function tokenExpiry(tok: string): { isJwt: boolean; expiresAt: string | null; expired: boolean | null } {
  const parts = tok.split('.')
  if (parts.length !== 3) return { isJwt: false, expiresAt: null, expired: null }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (typeof payload?.exp !== 'number') return { isJwt: true, expiresAt: null, expired: null }
    return { isJwt: true, expiresAt: new Date(payload.exp * 1000).toISOString(), expired: payload.exp * 1000 < Date.now() }
  } catch { return { isJwt: false, expiresAt: null, expired: null } }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms))])
}

interface PathResult { ok: boolean; ms: number; detail: string; error: string | null }

async function probeDirect(tok: string): Promise<PathResult> {
  const t0 = Date.now()
  if (!tok) return { ok: false, ms: 0, detail: 'not attempted', error: 'EUKA_BEARER_TOKEN is not set in this environment' }
  let client: Client | null = null
  try {
    const url = new URL(process.env.EUKA_MCP_URL || DEFAULT_URL)
    const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${tok}` } } })
    client = new Client({ name: 'ruff-liners-dashboard-probe', version: '1.0.0' })
    await withTimeout(client.connect(transport), 30_000, 'MCP connect')
    const res: any = await withTimeout(client.callTool({ name: TOOL, arguments: {} }), 60_000, TOOL)
    const text = (res.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
    if (res.isError) return { ok: false, ms: Date.now() - t0, detail: `${TOOL} returned an error`, error: redact(text, [tok]) }
    let brands: any[] = []
    try { const j = JSON.parse(text); brands = Array.isArray(j) ? j : (j?.brands ?? j?.items ?? []) } catch { /* non-JSON text still proves auth */ }
    const hasBrand = brands.some(b => (b?.brandId ?? b?.id) === BRAND_ID)
    // One brand-scoped data call, so a token that can list brands but not read data is caught here
    const y = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
    const ov: any = await withTimeout(client.callTool({ name: 'get_dashboard_performance_overview', arguments: { brandId: BRAND_ID, startDate: y, endDate: y, compareTo: { type: 'none' } } }), 90_000, 'get_dashboard_performance_overview')
    const ovText = (ov.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
    if (ov.isError) return { ok: false, ms: Date.now() - t0, detail: `${TOOL} ok (${brands.length} brand(s)); get_dashboard_performance_overview returned an error`, error: redact(ovText, [tok]) }
    let keys = 0
    try { keys = Object.keys(JSON.parse(ovText) ?? {}).length } catch { /* ignore */ }
    return { ok: true, ms: Date.now() - t0, detail: `${TOOL}: ${brands.length} brand(s), Ruff Liners brand ${hasBrand ? 'found' : 'NOT found'}; get_dashboard_performance_overview for ${y}: ${keys} field(s) returned`, error: null }
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, detail: 'direct MCP call failed', error: redact((e as Error)?.message ?? String(e), [tok]) }
  } finally { await client?.close().catch(() => {}) }
}

function anthropicPost(apiKey: string, bodyStr: string, timeoutMs: number): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      hostname: 'api.anthropic.com', port: 443, path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'mcp-client-2025-04-04', 'Content-Length': Buffer.byteLength(bodyStr) },
    }, res => {
      const chunks: Buffer[] = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString('utf-8') }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Anthropic request timeout after ${Math.round(timeoutMs / 1000)}s`)))
    req.write(bodyStr); req.end()
  })
}

async function anthropicKey(): Promise<{ key: string | null; source: 'env' | 'db' | 'none' }> {
  if (process.env.ANTHROPIC_API_KEY) return { key: process.env.ANTHROPIC_API_KEY, source: 'env' }
  try {
    const { data } = await supabaseAdmin().from('app_config').select('value').eq('key', 'anthropic_api_key').single()
    return data?.value ? { key: data.value as string, source: 'db' } : { key: null, source: 'none' }
  } catch { return { key: null, source: 'none' } }
}

async function probeConnector(tok: string, apiKey: string | null): Promise<PathResult> {
  const t0 = Date.now()
  if (!apiKey) return { ok: false, ms: 0, detail: 'not attempted', error: 'No Anthropic API key (ANTHROPIC_API_KEY env var or app_config.anthropic_api_key)' }
  if (!process.env.EUKA_MCP_URL) return { ok: false, ms: 0, detail: 'not attempted', error: 'EUKA_MCP_URL is not set in this environment (jobs/run requires it)' }
  try {
    // Same server block /api/jobs/run sends
    const srv: any = { type: 'url', url: process.env.EUKA_MCP_URL, name: 'euka' }
    if (tok) srv.authorization_token = tok
    const body = {
      model: (process.env.EXTRACTION_MODEL || 'claude-sonnet-4-6').trim(), max_tokens: 300,
      messages: [{ role: 'user', content: `Call the ${TOOL} tool exactly once with no arguments. Then reply with only: BRANDS=<number of brands returned>. Do not call any other tool.` }],
      mcp_servers: [srv],
    }
    const res = await anthropicPost(apiKey, JSON.stringify(body), 150_000)
    const secrets = [tok, apiKey]
    if (res.status < 200 || res.status >= 300) return { ok: false, ms: Date.now() - t0, detail: `Anthropic API returned ${res.status}`, error: redact(res.text, secrets) }
    const data = JSON.parse(res.text)
    const blocks: any[] = data?.content ?? []
    const uses = blocks.filter(b => b.type === 'mcp_tool_use')
    const results = blocks.filter(b => b.type === 'mcp_tool_result')
    const text = blocks.filter(b => b.type === 'text').map(b => b.text).join(' ').trim()
    const resultText = (r: any) => (Array.isArray(r?.content) ? r.content.map((c: any) => c?.text ?? '').join('\n') : String(r?.content ?? ''))
    const bad = results.find(r => r.is_error)
    if (bad) return { ok: false, ms: Date.now() - t0, detail: `connector reached Euka but ${TOOL} returned an error`, error: redact(resultText(bad), secrets) }
    if (!results.length) return { ok: false, ms: Date.now() - t0, detail: `no tool result came back (${uses.length} tool call(s) attempted, stop_reason ${data?.stop_reason})`, error: redact(text || 'model made no MCP tool call', secrets) }
    return { ok: true, ms: Date.now() - t0, detail: `${TOOL} returned through the connector; model reply: ${redact(text, secrets).slice(0, 120)}; tokens in/out ${data?.usage?.input_tokens ?? '?'}/${data?.usage?.output_tokens ?? '?'}`, error: null }
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, detail: 'connector call failed', error: redact((e as Error)?.message ?? String(e), [tok, apiKey]) }
  }
}

async function tableCheck(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  let sb: ReturnType<typeof supabaseAdmin>
  try { sb = supabaseAdmin() } catch (e) { return { supabase: `unavailable: ${(e as Error).message}` } }
  for (const t of ['scorecards', 'scorecard_periods', 'scorecard_contest_months', 'scorecard_snapshots', 'scorecard_manual', 'scorecard_drift_log', 'app_config']) {
    const { count, error } = await sb.from(t).select('*', { count: 'exact', head: true })
    out[t] = error ? `ERROR: ${error.message}` : `${count ?? 0} row(s)`
  }
  return out
}

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get('rl-auth')?.value
  if (!cookie || !(await verifyToken(cookie))) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const tok = eukaToken()
  const ak = await anthropicKey()
  const [direct, connector, tables] = await Promise.all([probeDirect(tok), probeConnector(tok, ak.key), tableCheck()])
  const set = (k: string) => !!(process.env[k] || '').trim()
  const verdict = direct.ok && connector.ok ? 'BOTH paths work'
    : direct.ok ? 'ONLY (a) direct MCP works'
    : connector.ok ? 'ONLY (b) the Anthropic connector works'
    : 'NEITHER path works'

  return NextResponse.json({
    verdict,
    a_directMcp: direct,
    b_anthropicConnector: connector,
    eukaConfig: {
      EUKA_BEARER_TOKEN: { set: !!tok, ...tokenExpiry(tok) },
      EUKA_MCP_URL: { set: set('EUKA_MCP_URL'), usingDefault: !set('EUKA_MCP_URL') },
      EUKA_STORE_ID: { set: set('EUKA_STORE_ID') },
      anthropicKeySource: ak.source,
    },
    // Presence only (true/false), so the alert channel can be chosen without another round trip
    alertEnv: Object.fromEntries(['SLACK_WEBHOOK_URL', 'SLACK_BOT_TOKEN', 'RESEND_API_KEY', 'SENDGRID_API_KEY', 'POSTMARK_SERVER_TOKEN', 'SMTP_SERVER', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_USER', 'SMTP_PASSWORD', 'ALERT_EMAIL_FROM', 'REPORT_PUBLISH_TOKEN', 'DASHBOARD_URL', 'CRON_SECRET'].map(k => [k, set(k)])),
    tables,
    deploy: { env: process.env.VERCEL_ENV ?? null, commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null, region: process.env.VERCEL_REGION ?? null },
    checkedAt: new Date().toISOString(),
  }, { headers: { 'cache-control': 'no-store' } })
}
