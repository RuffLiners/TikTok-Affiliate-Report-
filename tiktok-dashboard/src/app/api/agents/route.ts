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

STORE_ID: ${STORE_ID}
EUKA_MCP: https://app.euka.ai/api/mcp

GOAL: Return a JSON array of every outreach AND CRM agent created in the last 30 days, each fully enriched.

## STEP 0 — Window

- CUTOFF = ${startDate} (inclusive)
- The list tool has no date parameter. Filter client-side: keep an agent only if the date portion of its created_time (UTC) is >= ${startDate}. Do not look for a date filter on the tool — there isn't one.

## STEP 1 — Enumerate

list_outreach_agents caps at limit=25 per call and has no pagination. On every call pass: botStatus=["running","stopped","error"], limit=25, archived=false, storeId=${STORE_ID}.

Run these searches:

OUTREACH (agentType="outreach"), searchQuery =
"", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "Video Volume", "GMV Contest", "New Agent"

CRM (agentType="crm"), searchQuery =
"", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "New Agent", "Video Volume", "GMV Contest", "Tiktoktshopbonus"

Merge all results → deduplicate by id → drop any agent with created_time older than ${startDate}.

Completeness guard. Each response includes a total. If, for any single searchQuery, your in-window count for that bucket hits the 25-row cap AND that call's total > 25, the bucket overflowed — add narrower date-string queries for it (e.g. "L2 - 5/2", "L2 - 5/1", "L2 - 4/3") and repeat until no in-window bucket is truncated. If you cannot confirm full in-window coverage, stop and report the gap — never return a partial array.

## STEP 2 — Enrich

For EVERY in-window agent, call get_outreach_agent(campaignId=id, storeId=${STORE_ID}). This is the only source for gmv_filter, kw_filter, other_filters, list_segment, and commission_display.

## STEP 3 — Field map

| Output field        | Source |
|---------------------|--------|
| id                  | list.id |
| name                | list.campaign_name |
| agent_type          | "outreach" or "crm" — whichever list call produced it |
| campaign_type       | list.campaign_type |
| status              | list.bot_status |
| date_posted         | list.created_time, date only, YYYY-MM-DD |
| gmv_filter          | detail.target_gmvs joined with ", ", verbatim. "none" if null/empty. NEVER derive from campaign name. |
| kw_filter           | detail.target_categories joined with ", "; "none" if empty |
| other_filters       | Concise key: value summary of any other non-empty detail.target_* fields (target_avg_shoppable_video_views, target_avg_live_views, target_follower_counts, target_engagement_rate, target_creator_gender/target_gender, target_creator_languages, target_ages, target_fulfillment_rate, target_live_gmvs, target_ethnicity). "none" if all empty |
| list_segment        | If detail.lists non-empty → join their names; else if detail.segments non-empty → join their names; else detail.targeting_method ("filters"/"list"/"segment"); "none" if absent |
| commission_display  | Build from detail.product_commission_with_percentage (unique value, e.g. "20%") + if detail.include_shop_ads and detail.shop_ads_commission → append " + N% Shop Ads". Example: "20% + 6% Shop Ads". "none" if no commission data |
| creators_reached    | list.total_conversations |
| remaining           | list.remaining_creators |
| total_invites       | list.total_target_invites |
| accepted_invites    | list.total_target_accepted_invites |
| total_replies       | list.total_replies |
| samples_requested   | list.total_sample_request |
| samples_shipped     | list.total_samples_shipped |
| total_videos        | list.total_videos |
| total_revenue       | list.total_revenue |
| product_count       | length of list.products (0 if null) |
| has_followups       | list.has_followups |

## STEP 4 — Output

Respond with ONLY the JSON array [ ... ]. No prose, no markdown fences. One object per in-window agent.

{ "id":0,"name":"","agent_type":"outreach","campaign_type":"","status":"running","date_posted":"YYYY-MM-DD","gmv_filter":"","kw_filter":"","other_filters":"","list_segment":"","commission_display":"","creators_reached":0,"remaining":0,"total_invites":0,"accepted_invites":0,"total_replies":0,"samples_requested":0,"samples_shipped":0,"total_videos":0,"total_revenue":0,"product_count":0,"has_followups":false }`
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
    const mcpServers = [{ type: 'url', url: process.env.EUKA_MCP_URL!, name: 'euka', ...(tok ? { authorization_token: tok } : {}) }]
    const followUpBody = {
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: data.content || [] },
        { role: 'user', content: 'Now output ONLY the JSON array. Start with [ and end with ]. Nothing else.' }
      ],
      mcp_servers: mcpServers
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
