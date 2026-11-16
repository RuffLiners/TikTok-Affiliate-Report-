import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { EukaLike } from '@/lib/scorecard/engine'

/** Never let a token reach a log, an alert or the browser. */
export function redactSecrets(text: string): string {
  let out = String(text ?? '')
  const raw = (process.env.EUKA_BEARER_TOKEN || '').trim()
  const tok = raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw
  if (tok.length >= 6) out = out.split(tok).join('[redacted]')
  return out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/g, 'Bearer [redacted]').replace(/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]')
}

/**
 * Direct MCP client for Euka, the same path pipeline/src/euka.ts uses (proved from Vercel by /api/admin/euka-probe).
 * Shorter timeouts and fewer retries than the GitHub run, because a server function has a hard time limit.
 */
export async function connectEuka(): Promise<EukaLike & { close: () => Promise<void> }> {
  const raw = (process.env.EUKA_BEARER_TOKEN || '').trim()
  const tok = raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw
  if (!tok) throw new Error('EUKA_BEARER_TOKEN is not set in Vercel')
  const transport = new StreamableHTTPClientTransport(new URL(process.env.EUKA_MCP_URL || 'https://app.euka.ai/api/mcp'), { requestInit: { headers: { Authorization: `Bearer ${tok}` } } })
  const client = new Client({ name: 'ruff-liners-dashboard', version: '1.0.0' })
  try { await client.connect(transport) } catch (e) { throw new Error(`Could not connect to Euka: ${redactSecrets((e as Error).message)}`) }
  const memo = new Map<string, Promise<unknown>>()
  return {
    async call(name, args = {}) {
      let last: unknown
      for (let i = 0; i < 3; i++) {
        try {
          const res: any = await client.callTool({ name, arguments: args }, undefined, { timeout: 60_000 })
          const text = (res.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
          if (res.isError) throw new Error(`${name}: ${text.slice(0, 300)}`)
          try { return JSON.parse(text) } catch { return text }
        } catch (e) { last = e; if (i < 2) await new Promise(r => setTimeout(r, 1500 * (i + 1))) }
      }
      throw new Error(redactSecrets(`${name} failed after 3 tries: ${(last as Error)?.message}`))
    },
    // Within one step, never ask Euka the same question twice
    cache<T>(reportDate: string, step: string, fn: () => Promise<T>): Promise<T> {
      const k = `${reportDate}|${step}`
      if (!memo.has(k)) memo.set(k, fn().catch(e => { memo.delete(k); throw e }))
      return memo.get(k) as Promise<T>
    },
    close: () => client.close(),
  }
}
