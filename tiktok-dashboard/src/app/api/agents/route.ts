import { NextRequest, NextResponse } from 'next/server'
import { request as httpsRequest } from 'https'
import { format, subDays } from 'date-fns'
import { OutreachAgentRow } from '@/lib/types'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 800

const STORE_ID = process.env.EUKA_STORE_ID!

async function getAnthropicKey(): Promise<string | null> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try {
    const sb = supabaseAdmin()
    const { data } = await sb.from('app_config').select('value').eq('key', 'anthropic_api_key').single()
    return (data?.value as string) ?? null
  } catch { return null }
}

function buildAgentsPrompt(startDate: string, endDate: string): string {
  return `You are a data extraction agent for Ruff Liners TikTok Shop.

STORE ID: ${STORE_ID}
DATE WINDOW: ${startDate} to ${endDate}

TASK: Fetch all outreach AND CRM agents for store ${STORE_ID}.

STEPS:
1. Call list_outreach_agents with agentType="outreach", limit=50 for store ${STORE_ID}
2. Call list_outreach_agents with agentType="crm", limit=50 for store ${STORE_ID}
3. Include ALL agents from both lists (do NOT filter by date — return everything).
4. For each agent, use only the data returned by list_outreach_agents — do NOT call get_outreach_agent.
5. Output ONLY the JSON array — no prose, no markdown.

CRITICAL OUTPUT RULE: Your entire response must be a single JSON array starting with [ and ending with ]. No text before or after.

JSON SCHEMA (one object per agent, use null/0/[] for any missing fields):
{
  "id": <number>,
  "name": "<campaign_name>",
  "agent_type": "outreach" or "crm",
  "campaign_type": "<campaign_type>",
  "status": "<bot_status>",
  "date_posted": "<created_time ISO string>",
  "creators_reached": <total_conversations or 0>,
  "remaining": <remaining_creators or 0>,
  "samples_requested": <total_sample_request or 0>,
  "samples_shipped": <total_samples_shipped or 0>,
  "total_replies": <total_replies or 0>,
  "total_videos": <total_videos or 0>,
  "total_revenue": <total_revenue or 0>,
  "post_rate": <post_rate or 0>,
  "accepted_invites": <total_target_accepted_invites or 0>,
  "total_invites": <total_target_invites or 0>,
  "has_followups": <has_followups boolean or false>,
  "use_ai_personalization": false,
  "daily_limit": null,
  "targeting_method": "",
  "target_categories": [],
  "target_gmvs": [],
  "target_avg_views": [],
  "target_followers": [],
  "target_gender": null,
  "target_engagement": null,
  "free_samples": false,
  "commission": [],
  "products": [],
  "message": "",
  "collab_message": ""
}`
}

function anthropicPost(apiKey: string, bodyStr: string): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-04-04',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        resolve({
          ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
          status: res.statusCode ?? 0,
          text: async () => body
        })
      })
    })
    req.on('error', reject)
    req.setTimeout(750_000, () => req.destroy(new Error('agents timeout')))
    req.write(bodyStr)
    req.end()
  })
}

function extractTextBlocks(data: any): string {
  return (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
}

async function callAgentsClaude(prompt: string, apiKey: string): Promise<OutreachAgentRow[]> {
  const raw = (process.env.EUKA_BEARER_TOKEN || '').trim()
  const tok = raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw

  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
    mcp_servers: [{ type: 'url', url: process.env.EUKA_MCP_URL!, name: 'euka', ...(tok ? { authorization_token: tok } : {}) }]
  }

  const bodyStr = JSON.stringify(body)
  const res = await anthropicPost(apiKey, bodyStr)
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Claude API ${res.status}: ${t.slice(0, 300)}`)
  }

  const data = JSON.parse(await res.text())
  let text = extractTextBlocks(data)

  // Follow-up turn if Claude responded in prose instead of a JSON array
  if (text.indexOf('[') === -1) {
    const followUpBody = {
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: data.content || [] },
        { role: 'user', content: 'Now output ONLY the JSON array. Start with [ and end with ]. Nothing else.' }
      ]
    }
    const res2 = await anthropicPost(apiKey, JSON.stringify(followUpBody))
    if (!res2.ok) throw new Error(`Claude follow-up ${res2.status}`)
    const data2 = JSON.parse(await res2.text())
    text = extractTextBlocks(data2)
  }

  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1) throw new Error('No JSON array in agents response')
  return JSON.parse(text.slice(start, end + 1))
}

// GET — fetch agents live from Claude/MCP
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const reportDate = searchParams.get('reportDate')

  const anthropicKey = await getAnthropicKey()
  if (!anthropicKey) return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 503 })
  if (!process.env.EUKA_MCP_URL) return NextResponse.json({ error: 'EUKA_MCP_URL not configured' }, { status: 503 })

  const endDate = reportDate ? reportDate : format(new Date(), 'yyyy-MM-dd')
  const startDate = format(subDays(new Date(endDate + 'T00:00:00'), 30), 'yyyy-MM-dd')
  const prompt = buildAgentsPrompt(startDate, endDate)

  try {
    const agents = await callAgentsClaude(prompt, anthropicKey)
    return NextResponse.json({ agents, startDate, endDate })
  } catch (e: any) {
    console.error('Agents fetch error:', e?.message)
    return NextResponse.json({ error: e?.message || 'Failed to fetch agents' }, { status: 502 })
  }
}

// POST — save fetched agents into weekly_reports for persistence
export async function POST(req: NextRequest) {
  const { reportDate, agents } = await req.json().catch(() => ({}))
  if (!reportDate || !Array.isArray(agents)) {
    return NextResponse.json({ error: 'Missing reportDate or agents' }, { status: 400 })
  }

  let supabase: ReturnType<typeof supabaseAdmin>
  try { supabase = supabaseAdmin() } catch (e: any) {
    return NextResponse.json({ error: `DB config error: ${e?.message}` }, { status: 503 })
  }

  const { error } = await supabase
    .from('weekly_reports')
    .update({ agents })
    .eq('report_date', reportDate)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
