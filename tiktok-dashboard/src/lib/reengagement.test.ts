import { describe, expect, it } from 'vitest'
import { computeReengagement, isoWeekMonday, levelFromGmv, relevantTags, ReMember } from './reengagement'

describe('re-engagement (shared by phase 26 and the GitHub weekly report)', () => {
  it('ISO week labels map to their Monday', () => {
    expect(isoWeekMonday('2026-W47')).toBe('2026-11-16')
    expect(isoWeekMonday('2026-W46')).toBe('2026-11-09')
    expect(isoWeekMonday('2027-W01')).toBe('2027-01-04')
  })
  it('levels follow the skill thresholds', () => {
    expect(levelFromGmv(4999)).toBe('L1'); expect(levelFromGmv(5000)).toBe('L2'); expect(levelFromGmv(60000)).toBe('L4'); expect(levelFromGmv(2e6)).toBe('L7'); expect(levelFromGmv(null)).toBe('unknown')
  })
  const tags = [
    { id: 'a', name: 'RE 2026-W47 G1 Lapsed earners', memberCount: 3 }, { id: 'b', name: 'RE 2026-W47 G1 HOLDOUT', memberCount: 2 },
    { id: 'c', name: 'RE 2026-W46 G1 Lapsed earners', memberCount: 1 }, { id: 'h', name: 'RE 2026-W42 G1 Old', memberCount: 1 },
    { id: 'w', name: 'WATCH L4+ Silent', memberCount: 3 }, { id: 'f', name: 'WATCH first 2026-W47', memberCount: 3 },
    { id: 'r', name: 'ROCIO L4+', memberCount: 5 }, { id: 'p', name: 'ROCIO PERSONAL 2026-W47', memberCount: 1 }, { id: 'g', name: 'ROCIO AGENT 2026-W47', memberCount: 2 },
    { id: 'd', name: 'In Discord', memberCount: 1 }, { id: 'x', name: 'Contest: November', memberCount: 9 },
  ]
  const m = (id: string, lastPosted: string | null, t: string[], gmv = 1000, handle = id): ReMember => ({ id, handle, gmv30d: gmv, lastPosted, tags: t })
  const members = [
    m('u1', '2026-11-17', ['RE 2026-W47 G1 Lapsed earners']), m('u2', '2026-11-16', ['RE 2026-W47 G1 Lapsed earners']), m('u3', null, ['RE 2026-W47 G1 Lapsed earners']),
    m('h1', '2026-11-18', ['RE 2026-W47 G1 HOLDOUT']), m('h2', '2026-10-01', ['RE 2026-W47 G1 HOLDOUT']),
    m('o1', '2026-11-12', ['RE 2026-W46 G1 Lapsed earners']),
    m('v1', '2026-11-17', ['WATCH L4+ Silent', 'WATCH first 2026-W47', 'ROCIO PERSONAL 2026-W47', 'In Discord'], 80000),
    m('v2', '2026-11-01', ['WATCH L4+ Silent', 'WATCH first 2026-W47', 'ROCIO AGENT 2026-W47'], 200000),
    m('v3', '2026-11-20', ['WATCH L4+ Silent', 'WATCH first 2026-W47', 'ROCIO AGENT 2026-W47'], 70000),
  ]
  it('keeps the last 4 RE weeks and every VIP tag, nothing else', () => {
    const names = relevantTags(tags, 2).map(t => t.name)
    expect(names).not.toContain('RE 2026-W42 G1 Old'); expect(names).not.toContain('Contest: November')
    expect(names).toContain('WATCH L4+ Silent'); expect(names).toContain('In Discord'); expect(names).toContain('ROCIO L4+')
  })
  it('computes manual list results against the holdout', () => {
    const d = computeReengagement({ asOf: '2026-11-23', tags, members, agentConversations: { 7: 12, 8: 0 },
      lists: [{ name: '2026-W47 G1 Lapsed earners', linkedAgentIds: [7] }, { name: '2026-W46 G1 Lapsed earners', linkedAgentIds: [8, 99] }] })
    const [w47, w46] = d.manual.weeks
    expect(w47.week).toBe('2026-W47'); expect(w47.listDate).toBe('2026-11-16')
    expect(w47.groups[0]).toMatchObject({ group: 'G1', name: 'Lapsed earners', listed: 3, heldOut: 2, sent: true, posted: 1, postedHoldout: 1, postRatePct: 33.3, holdoutPostRatePct: 50, liftPts: -16.7, holdoutTooSmall: true })
    expect(w46.groups[0].sent).toBeNull() // agent 99 was not read
    expect(d.manual.weeks.map(x => x.week)).toEqual(['2026-W47', '2026-W46', '2026-W42'])
  })
  it('computes the VIP watch list, reactivation and channel split', () => {
    const d = computeReengagement({ asOf: '2026-11-23', tags, members, lists: [], agentConversations: {} })
    expect(d.vip).toMatchObject({ watchTag: 'WATCH L4+ Silent', rocioL4Total: 5, onWatchList: 3, reactivated: 2, stillSilent: 1, inDiscord: 1, personal: { listed: 1, reactivated: 1 }, agent: { listed: 2, reactivated: 1 } })
    expect(d.vip.reactivatedCreators.map(x => x.h)).toEqual(['v1', 'v3'])
    expect(d.vip.reactivatedCreators[0]).toMatchObject({ level: 'L4', channel: 'personal', firstListedWeek: '2026-W47' })
  })
  it('no tags yet: empty weeks, watch list 0', () => {
    const d = computeReengagement({ asOf: '2026-11-23', tags: [], members: [], lists: [], agentConversations: {} })
    expect(d.manual.weeks).toEqual([]); expect(d.vip.onWatchList).toBe(0); expect(d.vip.watchTag).toBeNull()
  })
})
