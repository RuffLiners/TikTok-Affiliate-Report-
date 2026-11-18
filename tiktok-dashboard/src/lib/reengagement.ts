/**
 * Re-engagement sections (spec v3.2): "Manual Re-engagements (Alyssa List)" and "VIP Engagements (Rocio List)".
 *
 * One copy, two callers:
 *   - the dashboard job, phase 26 (src/app/api/jobs/run/route.ts), which hands the tag rules and the writing rules
 *     below to Claude with Euka tools;
 *   - the GitHub weekly report (pipeline/src/weekly-report.ts), which reads the same tags with typed Euka calls and
 *     computes every number here in code, so Claude only writes the prose.
 * Both read the Euka CRM tags the Monday Rocio and Alyssa routines write. READ ONLY: nothing here changes Euka.
 */

/** Tag families read. Names are matched on these prefixes (case-sensitive, as the routines write them). */
export const REENGAGEMENT_TAG_PREFIXES = ['RE ', 'REACTIVATED ', 'ROCIO L4+', 'ROCIO PERSONAL ', 'ROCIO AGENT ', 'WATCH L4+ Silent', 'WATCH first ', 'In Discord'] as const
/** The watch-list tag. Older reports used the L5+ name; it is still read if the L4+ tag is missing. */
export const WATCH_TAGS = ['WATCH L4+ Silent', 'WATCH L5+ Silent'] as const

export const REENGAGEMENT_TAG_RULES = `A) MANUAL RE-ENGAGEMENTS (Alyssa list). Tags named "RE <ISO-week> G<n> <group name>" are the contacted creators of a weekly list, and "RE <ISO-week> G<n> HOLDOUT" are creators deliberately NOT messaged. The ISO week label is YYYY-Www and the list date is the MONDAY of that ISO week. Each group also has a member list named "<ISO-week> G<n> <group name>". Use the most recent 4 list weeks that have tags. For each week and group G1..G6: listed = member count of the group tag; heldOut = member count of the HOLDOUT tag; sent = true if an outreach/CRM agent linked to that week's member list for the group has total_conversations above 0, false if no linked agent has, null if the list cannot be found; posted = how many creators with the group tag have a last video posted date AFTER the list date; postedHoldout = the same for the HOLDOUT tag. If a tag family does not exist yet, output weeks as [].

B) VIP ENGAGEMENTS (Rocio list). "ROCIO L4+" holds every L4+ creator on Rocio's list. "WATCH L4+ Silent" holds the L4+ creators who were silent when listed (older weeks used "WATCH L5+ Silent"). "WATCH first <ISO-week>" records the week a creator was first listed. "ROCIO PERSONAL <ISO-week>" marks creators Rocio messaged herself that week, "ROCIO AGENT <ISO-week>" those messaged by an agent. "REACTIVATED <ISO-week>" marks creators who posted after being listed. "In Discord" marks creators known to be in Discord. onWatchList = members with the WATCH tag; reactivated = those with a REACTIVATED tag or whose last video posted date is after the Monday of their "WATCH first" week; stillSilent = onWatchList minus reactivated; inDiscord = members of the WATCH list that also carry "In Discord"; split reactivation by PERSONAL vs AGENT. If the WATCH tag does not exist yet, set onWatchList to 0 and say so in the text.`

export const REENGAGEMENT_WRITING_RULES = `- "manualReengagement" (2-3 paragraphs): what the manual lists were this week and last (sizes, held out), whether they were sent, reactivation rate against the holdout rate and the lift, and what to change. RULES: a post after listing is credited to a message ONLY by comparing against the holdout; when a holdout has fewer than 20 creators say the sample is too small to read lift; when no list has been sent say there are no results yet. State the window each number came from (list week).
- "vipEngagement" (2-3 paragraphs): how many L4+ creators are on the watch list, how many started posting again and who (by handle), how long they took where known, personal versus agent outreach, how many are in Discord. RULES: a post after listing does not prove our outreach caused it because this list has no holdout; if tags do not exist yet say tracking has just started.
Every figure in the prose must come from the numbers given. If data is missing say "not tracked yet" and never invent a number.`

export interface ReTag { id: string; name: string; memberCount?: number }
export interface ReMember { id: string; handle: string | null; gmv30d: number | null; lastPosted: string | null; tags: string[] }
export interface ReList { name: string; linkedAgentIds: number[] }

export interface ManualGroup { group: string; name: string; listed: number; heldOut: number; sent: boolean | null; posted: number; postedHoldout: number; postRatePct: number | null; holdoutPostRatePct: number | null; liftPts: number | null; holdoutTooSmall: boolean }
export interface ManualWeek { week: string; listDate: string; groups: ManualGroup[] }
export interface VipReactivated { h: string; level: string; gmv30d: number; firstListedWeek: string | null; channel: 'personal' | 'agent' | 'both' | 'unknown'; weeksToReactivate: number | null }
export interface ReengagementData {
  asOf: string
  manual: { weeks: ManualWeek[] }
  vip: {
    watchTag: string | null; rocioL4Total: number | null; onWatchList: number; reactivated: number; stillSilent: number; inDiscord: number
    personal: { listed: number; reactivated: number }; agent: { listed: number; reactivated: number }
    reactivatedCreators: VipReactivated[]
  }
}

const RE_TAG = /^RE (\d{4}-W\d{2}) (G\d+) (.+)$/
const WEEK_TAG = (prefix: string) => new RegExp(`^${prefix.replace(/[+]/g, '\\+')}(\\d{4}-W\\d{2})$`)

/** Monday (YYYY-MM-DD) of an ISO week label such as 2026-W47. */
export function isoWeekMonday(label: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(label)
  if (!m) throw new Error(`not an ISO week label: ${label}`)
  const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4))
  const mon1 = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000)
  return new Date(mon1.getTime() + (Number(m[2]) - 1) * 7 * 86400000).toISOString().slice(0, 10)
}
const weeksBetween = (a: string, b: string) => Math.round((Date.parse(isoWeekMonday(b)) - Date.parse(isoWeekMonday(a))) / (7 * 86400000))

/** Creator level from current global 30-day GMV (SKILL.md thresholds). */
export function levelFromGmv(g: number | null): string {
  if (g == null) return 'unknown'
  const cuts = [5e3, 25e3, 60e3, 150e3, 400e3, 1.5e6]
  return `L${cuts.filter(c => g >= c).length + 1}`
}
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null)

/** Tags the pipeline must read members for: the last `weeks` RE weeks plus every VIP tag. */
export function relevantTags(tags: ReTag[], weeks = 4): ReTag[] {
  const reWeeks = [...new Set(tags.map(t => RE_TAG.exec(t.name)?.[1]).filter(Boolean) as string[])].sort().reverse().slice(0, weeks)
  return tags.filter(t => {
    const re = RE_TAG.exec(t.name)
    if (re) return reWeeks.includes(re[1])
    return REENGAGEMENT_TAG_PREFIXES.some(p => p !== 'RE ' && t.name.startsWith(p)) || (WATCH_TAGS as readonly string[]).includes(t.name)
  })
}

/**
 * Compute both sections' numbers from tags, the members carrying them, the RE member lists with their linked
 * agents, and each agent's total_conversations. Pure: no I/O, so the same function is tested and reused.
 */
export function computeReengagement(input: { asOf: string; tags: ReTag[]; members: ReMember[]; lists: ReList[]; agentConversations: Record<number, number>; weeks?: number }): ReengagementData {
  const { tags, members, lists, agentConversations } = input
  const byTag = new Map<string, ReMember[]>()
  for (const m of members) for (const t of m.tags) { if (!byTag.has(t)) byTag.set(t, []); byTag.get(t)!.push(m) }
  const count = (name: string) => { const t = tags.find(x => x.name === name); return t?.memberCount ?? byTag.get(name)?.length ?? 0 }
  const postedAfter = (name: string, day: string) => (byTag.get(name) ?? []).filter(m => m.lastPosted && m.lastPosted > day).length

  // A) manual lists
  const parsed = tags.map(t => ({ t, m: RE_TAG.exec(t.name) })).filter(x => x.m) as Array<{ t: ReTag; m: RegExpExecArray }>
  const weekLabels = [...new Set(parsed.map(x => x.m[1]))].sort().reverse().slice(0, input.weeks ?? 4)
  const weeks: ManualWeek[] = weekLabels.map(week => {
    const listDate = isoWeekMonday(week)
    const groups = [...new Set(parsed.filter(x => x.m[1] === week).map(x => x.m[2]))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    return {
      week, listDate,
      groups: groups.map(g => {
        const named = parsed.find(x => x.m[1] === week && x.m[2] === g && x.m[3] !== 'HOLDOUT')
        const name = named?.m[3] ?? ''
        const groupTag = named?.t.name ?? ''
        const holdTag = `RE ${week} ${g} HOLDOUT`
        const listed = groupTag ? count(groupTag) : 0, heldOut = count(holdTag)
        const list = lists.find(l => l.name === `${week} ${g} ${name}`)
        // true: a linked agent has conversations; false: every linked agent is known and has none (or none is linked);
        // null: no list, or a linked agent whose numbers were not read
        const sent = !list ? null
          : list.linkedAgentIds.some(id => (agentConversations[id] ?? 0) > 0) ? true
          : list.linkedAgentIds.some(id => agentConversations[id] === undefined) ? null : false
        const posted = groupTag ? postedAfter(groupTag, listDate) : 0, postedHoldout = postedAfter(holdTag, listDate)
        const pr = pct(posted, listed), hr = pct(postedHoldout, heldOut)
        return { group: g, name, listed, heldOut, sent, posted, postedHoldout, postRatePct: pr, holdoutPostRatePct: hr,
          liftPts: pr != null && hr != null ? Math.round((pr - hr) * 10) / 10 : null, holdoutTooSmall: heldOut < 20 }
      }),
    }
  })

  // B) VIP list
  const watchTag = WATCH_TAGS.find(n => tags.some(t => t.name === n)) ?? null
  const watch = watchTag ? byTag.get(watchTag) ?? [] : []
  const weekOf = (m: ReMember, prefix: string) => m.tags.map(t => WEEK_TAG(prefix).exec(t)?.[1]).filter(Boolean).sort()[0] as string | undefined
  const personal = { listed: 0, reactivated: 0 }, agent = { listed: 0, reactivated: 0 }
  const reactivatedCreators: VipReactivated[] = []
  for (const m of watch) {
    const first = weekOf(m, 'WATCH first ') ?? [weekOf(m, 'ROCIO PERSONAL '), weekOf(m, 'ROCIO AGENT ')].filter(Boolean).sort()[0] ?? null
    const reTag = weekOf(m, 'REACTIVATED ')
    const isP = m.tags.some(t => t.startsWith('ROCIO PERSONAL ')), isA = m.tags.some(t => t.startsWith('ROCIO AGENT '))
    const react = !!reTag || (!!first && !!m.lastPosted && m.lastPosted > isoWeekMonday(first))
    if (isP) { personal.listed++; if (react) personal.reactivated++ }
    if (isA) { agent.listed++; if (react) agent.reactivated++ }
    if (react) reactivatedCreators.push({ h: m.handle ?? '(no handle)', level: levelFromGmv(m.gmv30d), gmv30d: Math.round((m.gmv30d ?? 0) * 100) / 100, firstListedWeek: first,
      channel: isP && isA ? 'both' : isP ? 'personal' : isA ? 'agent' : 'unknown', weeksToReactivate: reTag && first ? weeksBetween(first, reTag) : null })
  }
  reactivatedCreators.sort((a, b) => b.gmv30d - a.gmv30d)
  const reactivated = reactivatedCreators.length
  return {
    asOf: input.asOf,
    manual: { weeks },
    vip: {
      watchTag, rocioL4Total: tags.some(t => t.name === 'ROCIO L4+') ? count('ROCIO L4+') : null,
      onWatchList: watchTag ? count(watchTag) : 0, reactivated, stillSilent: (watchTag ? count(watchTag) : 0) - reactivated,
      inDiscord: watch.filter(m => m.tags.includes('In Discord')).length, personal, agent,
      reactivatedCreators: reactivatedCreators.slice(0, 10),
    },
  }
}

/** Every number in the data, for the audit's traced-figure pool. */
export function reengagementNumbers(d: ReengagementData): number[] {
  const out: number[] = []
  const walk = (o: unknown) => { if (typeof o === 'number' && Number.isFinite(o)) out.push(o); else if (o && typeof o === 'object') Object.values(o).forEach(walk) }
  walk(d)
  return out
}
