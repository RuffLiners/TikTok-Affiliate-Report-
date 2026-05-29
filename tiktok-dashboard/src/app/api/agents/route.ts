import { NextRequest, NextResponse } from 'next/server'
import { request as httpsRequest } from 'https'
import { format, subDays } from 'date-fns'
import { OutreachAgentRow } from '@/lib/types'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

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

TASK: Fetch all outreach AND CRM agents created on or after ${startDate}.

STEPS:
1. Call list_outreach_agents with agentType="outreach", limit=25 for store ${STORE_ID}
2. Call list_outreach_agents with agentType="crm", limit=25 for store ${STORE_ID}
3. For every agent with created_time >= "${startDate}", call get_outreach_agent to get full details
4. Output ONLY the JSON array — no prose, no markdown.

CRITICAL OUTPUT RULE: Your entire response must be a single JSON array starting with [ and ending with ]. No text before or after.

JSON SCHEMA (one object per agent):
{
  "id": <number>,
  "name": "<campaign_name>",
  "agent_type": "outreach" or "crm",
  "campaign_type": "<campaign_type field>",
  "status": "<bot_status>",
  "date_posted": "<created_time ISO string>",
  "creators_reached": <total_conversations number>,
  "remaining": <remaining_creators number>,
  "samples_requested": <total_sample_request>,
  "samples_shipped": <total_samples_shipped>,
  "total_replies": <total_replies>,
  "total_videos": <total_videos>,
  "total_revenue": <total_revenue>,
  "post_rate": <post_rate>,
  "accepted_invites": <total_target_accepted_invites>,
  "total_invites": <total_target_invites>,
  "has_followups": <has_followups boolean>,
  "use_ai_personalization": <use_ai_personalization boolean, default false>,
  "daily_limit": <daily_limit or null>,
  "targeting_method": "<targeting_method>",
  "target_categories": [<target_categories array or []>],
  "target_gmvs": [<target_gmvs array or []>],
  "target_avg_views": [<target_avg_shoppable_video_views array or []>],
  "target_followers": [<target_follower_counts array or []>],
  "target_gender": <target_gender or null>,
  "target_engagement": <target_engagement_rate or null>,
  "free_samples": <target_collab_free_samples boolean, default false>,
  "commission": [{"productId":"<id>","rate":<commission>}],
  "products": [{"id":"<id>","title":"<title>"}],
  "message": "<message field>",
  "collab_message": "<target_collab_message or empty string>"
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
    req.setTimeout(280_000, () => req.destroy(new Error('agents timeout')))
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
