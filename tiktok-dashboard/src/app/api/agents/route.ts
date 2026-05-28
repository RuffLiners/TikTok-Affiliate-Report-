import { NextRequest, NextResponse } from 'next/server'
import { format, subDays } from 'date-fns'
import { OutreachAgentRow } from '@/lib/types'

export const dynamic = 'force-dynamic'

const STORE_ID = process.env.EUKA_STORE_ID!

function buildAgentsPrompt(startDate: string, endDate: string): string {
  return `You are a data extraction agent for Ruff Liners TikTok Shop.

STORE ID: ${STORE_ID}
DATE WINDOW: ${startDate} to ${endDate}

TASK: Fetch all outreach AND CRM agents created on or after ${startDate}.

STEPS:
1. Call list_outreach_agents with agentType="outreach", limit=25 for store ${STORE_ID}
2. Call list_outreach_agents with agentType="crm", limit=25 for store ${STORE_ID}
3. For every agent with created_time >= "${startDate}", call get_outreach_agent to get full details (message, targeting filters, products, commissions)
4. Output ONLY the JSON array below — no prose.

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
  "message": "<message field — the direct DM message text>",
  "collab_message": "<target_collab_message or empty string>"
}

Output ONLY a JSON array [ ... ] with no surrounding text.`
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const reportDate = searchParams.get('reportDate')

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 })
  }
  if (!process.env.EUKA_MCP_URL) {
    return NextResponse.json({ error: 'EUKA_MCP_URL not configured' }, { status: 503 })
  }

  const endDate   = reportDate ? reportDate : format(new Date(), 'yyyy-MM-dd')
  const startDate = format(subDays(new Date(endDate + 'T00:00:00'), 30), 'yyyy-MM-dd')

  const prompt = buildAgentsPrompt(startDate, endDate)

  let apiRes: Response
  try {
    apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-04-04'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        system: prompt,
        messages: [{ role: 'user', content: `Fetch and return all agents created from ${startDate} to ${endDate} as the JSON array.` }],
        mcp_servers: [{ type: 'url', url: process.env.EUKA_MCP_URL!, name: 'euka' }]
      })
    })
  } catch {
    return NextResponse.json({ error: 'Could not reach AI service' }, { status: 502 })
  }

  if (!apiRes.ok) {
    const txt = await apiRes.text()
    console.error('Agents Claude API error:', txt)
    return NextResponse.json({ error: 'AI service error' }, { status: 502 })
  }

  const claudeData = await apiRes.json()
  const text = (claudeData.content || [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('\n')

  const start = text.indexOf('[')
  const end   = text.lastIndexOf(']')
  if (start === -1 || end === -1) {
    console.error('No JSON array in response:', text.slice(0, 400))
    return NextResponse.json({ error: 'Could not parse agents response' }, { status: 422 })
  }

  let agents: OutreachAgentRow[]
  try {
    agents = JSON.parse(text.slice(start, end + 1))
  } catch {
    return NextResponse.json({ error: 'Invalid JSON in agents response' }, { status: 422 })
  }

  return NextResponse.json({ agents, startDate, endDate }, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' }
  })
}
