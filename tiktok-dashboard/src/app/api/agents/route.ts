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

function buildAgentsPrompt(_startDate: string, _endDate: string): string {
  return `You are a data extraction agent for Ruff Liners TikTok Shop.

STORE ID: ${STORE_ID}

TASK: Fetch ALL outreach AND CRM agents for store ${STORE_ID} and return them as a JSON array.

STEPS:
1. Call list_outreach_agents with agentType="outreach", limit=50 for store ${STORE_ID}
2. Call list_outreach_agents with agentType="crm", limit=50 for store ${STORE_ID}
3. Return ALL agents from both lists — no date filtering.
4. Do NOT call get_outreach_agent — use only what list_outreach_agents returns.
5. Output ONLY the JSON array. No prose, no markdown.

CRITICAL OUTPUT RULE: Your ENTIRE response must be a single JSON array starting with [ and ending with ]. Nothing before or after.

FIELD MAPPING — map list_outreach_agents fields to this exact JSON schema:
{
  "id": <campaign_id number>,
  "name": "<campaign_name>",
  "agent_type": "outreach" or "crm",
  "campaign_type": "<campaign_type string>",
  "status": "<bot_status: running|stopped|error>",
  "date_posted": "<created_time as ISO date string YYYY-MM-DD>",
  "gmv_filter": "<target_gmvs formatted as range string e.g. '$25K–$2M', or 'none'>",
  "kw_filter": "<keyword/search filter string, or '—' if none>",
  "other_filters": "<other attribute filters description, or 'none'>",
  "list_segment": "<list or segment name and size, or '— (filter-based)'>",
  "commission_display": "<organic_commission% / ads_commission% e.g. '20% / 10%', or '—'>",
  "creators_reached": <total_conversations number>,
  "remaining": <remaining_creators number>,
  "total_invites": <total_target_invites number>,
  "accepted_invites": <total_target_accepted_invites number>,
  "total_replies": <total_replies number>,
  "samples_requested": <total_sample_request number>,
  "samples_shipped": <total_samples_shipped number>,
  "total_videos": <total_videos number>,
  "total_revenue": <total_revenue number>,
  "product_count": <number of products in this campaign>,
  "has_followups": <has_followups boolean>,
  "post_rate": <post_rate number or 0>,
  "use_ai_personalization": <boolean or false>,
  "daily_limit": <daily_limit or null>,
  "targeting_method": "<targeting_method string>",
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
