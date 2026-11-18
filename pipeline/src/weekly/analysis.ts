// SKILL.md Phase 4: Claude writes the prose, code supplies every number. One Claude API call, no tools.
// After the call, every dollar figure the text quotes must trace to the report, controls or the derived facts below
// (same rule as audit_report.py check 9). Untraced figures get one re-prompt; still untraced fails the run.
import Anthropic from '@anthropic-ai/sdk'
import { REENGAGEMENT_WRITING_RULES } from '../../../tiktok-dashboard/src/lib/reengagement'

export const SECTIONS = ['performance', 'creators', 'recruiting', 'growth', 'manualReengagement', 'vipEngagement'] as const
export type Analysis = Record<typeof SECTIONS[number], string>

const MODEL = (process.env.ANALYSIS_MODEL || 'claude-opus-5-5').trim()

const RULES = `You are a senior analyst briefing the CEO of Ruff Liners (dog car accessories sold on TikTok Shop through affiliate creators). Write the analysis sections of this week's report.

Section briefs (paragraphs separated by a blank line, i.e. "\\n\\n"):
1. "performance" (3-4 paragraphs): the most recent complete Sun to Sat week and the 30-day window headline numbers versus the prior 30 days; what drove results, naming the creators, levels and products moving the numbers. If no monthly goal is given, say pacing against a goal is not available instead of inventing a target.
2. "creators" (2-3 paragraphs): new-creator breakouts by handle with their numbers; the top video this week (creator and GMV); which level is most active and most productive per creator; L6/L7 activation.
3. "recruiting" (2-3 paragraphs): named reactivation targets with their global GMV; the outreach mix versus where GMV actually comes from; samples by level; concrete next-week recruiting actions. msgs by level is Euka's invitesSent, which runs about 2x the dashboard headline messages; say so when you quote it.
4. "growth" (2-3 paragraphs): 13-week trend direction and momentum; the current growth engine; 2-3 specific opportunities and 1-2 risks; a 4-week outlook with upside and downside, labelled as an estimate.
5. and 6. The two re-engagement sections:
${REENGAGEMENT_WRITING_RULES}

Rules (non-negotiable):
- Use only numbers that appear in the data given. Do not compute new dollar figures; if you need a sum, share or difference, use one from "derived". Round only by abbreviating (for example $52.5K for 52,532.85).
- Say which GMV figure a statement uses: dashboard shop GMV, affiliate GMV, or creator-video GMV (d30.gmv, the level sum). They differ.
- Never attribute a creator's period GMV to videos that did not convert: check vmgmv and gmvN first.
- Ranges must include zero values in the data.
- Projections and outlooks are estimates; label them as such.
- If no L6/L7 target is given, say so instead of inventing one. A quarterly goal not given is an assumption; label it as one.
- Name creators by handle, levels as L1 to L7, amounts in dollars.
- Plain text only: no markdown, no bullet characters, no headings. Never use the em dash character; use a comma, a colon or a period instead.
- Data limits to disclose when they matter: product clicks are not available; video counts come from the dashboard and views/new creators from the video export, which can differ by a few percent; levels are current levels applied to past periods; GMV Max revenue and affiliate GMV overlap and are never added.`

const SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(SECTIONS.map(s => [s, { type: 'string' }])),
  required: [...SECTIONS],
  additionalProperties: false,
}

/** Every number in an object tree (the audit's pool). */
export function numbersIn(o: unknown, out: number[] = []): number[] {
  if (typeof o === 'number' && Number.isFinite(o)) out.push(o)
  else if (Array.isArray(o)) for (const v of o) numbersIn(v, out)
  else if (o && typeof o === 'object') for (const v of Object.values(o)) numbersIn(v, out)
  return out
}

/** Same matcher and tolerance as audit_report.py check 9. Returns the untraced dollar strings. */
export function untracedDollars(text: string, pool: number[]): string[] {
  const re = /\$([\d,]+(?:\.\d+)?)(K|M)?(?:[–-][\d,.]+(K|M))?/g
  const bad = new Set<string>()
  for (const m of text.matchAll(re)) {
    let n = Number(m[1].replace(/,/g, ''))
    const suffix = m[2] || m[3]
    n *= suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : 1
    const tol = suffix ? Math.max(0.006 * n, 1) : 1
    if (!pool.some(p => Math.abs(n - p) <= tol)) bad.add(m[0])
  }
  return [...bad].sort()
}

export function noEmDash(a: Analysis): Analysis {
  return Object.fromEntries(SECTIONS.map(s => [s, String(a[s] ?? '').replace(/\s*\u2014\s*/g, ', ')])) as Analysis
}

async function ask(client: Anthropic, user: string, prior?: { text: string; fix: string }): Promise<Analysis> {
  const messages: any[] = [{ role: 'user', content: user }]
  if (prior) messages.push({ role: 'assistant', content: prior.text }, { role: 'user', content: prior.fix })
  const res: any = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
    system: RULES,
    messages,
  } as any)
  if (res.stop_reason === 'refusal') throw new Error(`analysis call refused (${res.stop_details?.category ?? 'no category'})`)
  if (res.stop_reason === 'max_tokens') throw new Error('analysis call hit max_tokens')
  const text = (res.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
  const parsed = JSON.parse(text)
  for (const s of SECTIONS) if (typeof parsed[s] !== 'string' || !parsed[s].trim()) throw new Error(`analysis section "${s}" is empty`)
  return { ...parsed, _raw: text } as any
}

/**
 * Write the six sections. `pool` is every number in the report (minus analysis), controls and derived facts.
 * Returns the analysis and the derived numbers its dollar figures used.
 */
export async function writeAnalysis(input: { report: unknown; controls: unknown; derived: unknown; reengagement: unknown; pool: number[] }): Promise<{ analysis: Analysis; reprompted: boolean }> {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim()
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set (add it as a repo secret)')
  const client = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 600_000 })
  const user = `DATA (JSON). "report" is the finished weekly report without its analysis; "controls" are the audit controls from source; "derived" are extra figures computed in code for you; "reengagement" is the Alyssa and Rocio list data.\n\n${JSON.stringify({ report: input.report, controls: input.controls, derived: input.derived, reengagement: input.reengagement })}\n\nReturn the six sections as JSON.`
  let a: any = await ask(client, user)
  const check = (x: Analysis) => untracedDollars(SECTIONS.map(s => x[s]).join(' '), input.pool)
  let bad = check(a), reprompted = false
  const dash = SECTIONS.some(s => a[s].includes('\u2014'))
  if (bad.length || dash) {
    reprompted = true
    const fix = [
      bad.length ? `These dollar figures are not in the data: ${bad.join(', ')}. Replace each with a figure that is in the data (report, controls or derived), or remove it. Do not compute new dollar figures.` : '',
      dash ? 'Remove every em dash character.' : '',
    ].filter(Boolean).join(' ') + ' Return all six sections again as JSON.'
    a = await ask(client, user, { text: a._raw, fix })
    bad = check(a)
    if (bad.length) throw new Error(`analysis quotes dollar figures that do not trace to the data after one re-prompt: ${bad.join(', ')}`)
  }
  delete a._raw
  return { analysis: noEmDash(a), reprompted }
}
