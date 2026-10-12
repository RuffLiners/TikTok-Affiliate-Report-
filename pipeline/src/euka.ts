import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export const BRAND_ID = 'b4ec897a-fb59-48e7-9320-873ea5e25155'
export const STORE_ID = process.env.EUKA_STORE_ID || '455ea4f9-a404-411b-b748-9ba1929efb93'

export function bearer(): string {
  const raw = (process.env.EUKA_BEARER_TOKEN || '').trim()
  const tok = raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw
  if (!tok) throw new Error('EUKA_BEARER_TOKEN is not set')
  return tok
}

export async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 4): Promise<T> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try { return await fn() } catch (e) {
      last = e
      if (i < tries - 1) await new Promise(r => setTimeout(r, 2000 * 2 ** i))
    }
  }
  throw new Error(`${label} failed after ${tries} tries: ${(last as Error)?.message}`)
}

export class Euka {
  private client: Client
  private constructor(client: Client) { this.client = client }

  static async connect(): Promise<Euka> {
    const url = new URL(process.env.EUKA_MCP_URL || 'https://app.euka.ai/api/mcp')
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${bearer()}` } },
    })
    const client = new Client({ name: 'ruff-liners-report', version: '1.0.0' })
    await client.connect(transport)
    return new Euka(client)
  }

  /** Call a tool; returns parsed JSON from the text content (or raw text if not JSON). */
  async call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    return withRetry(async () => {
      const res: any = await this.client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })
      const text = (res.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
      if (res.isError) throw new Error(`${name}: ${text.slice(0, 300)}`)
      try { return JSON.parse(text) } catch { return text }
    }, name)
  }

  async close() { await this.client.close() }
}
