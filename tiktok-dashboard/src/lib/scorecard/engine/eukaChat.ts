// Line 7, "Euka Chat messages sent": messages the team sends in Euka Chat, the direct messaging inside Euka's creator app.
// It does NOT count the automated outreach that Euka agents deliver as TikTok Shop DMs.
// Euka has no dated total for this, so each Euka Chat conversation is read once and its team-sent messages are counted
// by Los Angeles calendar day. A conversation is only read again when it has new activity.
import type { EukaLike } from './pull'
import { BRAND_ID, EUKA_CONCURRENCY, mapPool } from './pull'
import { addDays } from '../index'

/** Per conversation: `at` is its latest activity (ms) when it was read, `days` the team-sent messages per LA day. */
export interface ChatThread { at: number; days: Record<string, number> }
export type ChatCache = Record<string, ChatThread>

const laDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

/** Every Euka Chat conversation with its latest-activity time. */
export async function listEukaChatThreads(e: EukaLike): Promise<Array<{ id: string; at: number }>> {
  const out: Array<{ id: string; at: number }> = []
  let cursor: string | undefined
  for (let page = 0; page < 200; page++) {
    const r = await e.call('list_inbox_threads', { brandId: BRAND_ID, filters: { channel: 'CreatorAppChat' }, limit: 100, sortBy: 'Newest', ...(cursor ? { cursor } : {}) })
    for (const t of r?.items ?? []) if (t?.id) out.push({ id: String(t.id), at: Number(t.internalDate) || 0 })
    cursor = r?.nextCursor || undefined
    if (!cursor) break
  }
  return out
}

/** Team-sent messages in one conversation, by LA day. Creator messages, internal notes and activity entries are not counted. */
export async function readThreadDays(e: EukaLike, threadId: string): Promise<Record<string, number>> {
  const days: Record<string, number> = {}
  let cursor: string | undefined
  for (let page = 0; page < 500; page++) {
    const r = await e.call('list_inbox_thread_timeline', { brandId: BRAND_ID, threadId, limit: 100, ...(cursor ? { cursor } : {}) })
    for (const m of r?.items ?? []) {
      if (m?.kind !== 'message' || m?.channel !== 'CreatorAppChat' || m?.senderType !== 'Manager') continue
      const ms = Date.parse(m?.data?.providerTimestamp ?? '') || Number(m?.internalDate)
      if (!Number.isFinite(ms) || ms <= 0) continue
      const d = laDay(ms); days[d] = (days[d] ?? 0) + 1
    }
    cursor = r?.nextCursor || undefined
    if (!cursor) break
  }
  return days
}

/**
 * Bring the cache up to date. Only conversations that are new or have new activity are read. `within` lets a caller
 * with a time limit stop early; `onChunk` saves progress so the next call carries on. Returns done=false if it stopped early.
 */
export async function refreshEukaChat(
  e: EukaLike, cache: ChatCache, o: { within?: () => boolean; onChunk?: (c: ChatCache) => Promise<void>; chunk?: number } = {},
): Promise<{ cache: ChatCache; done: boolean; read: number; threads: number }> {
  const threads = await listEukaChatThreads(e)
  const live = new Set(threads.map(t => t.id))
  const next: ChatCache = {}
  for (const [id, v] of Object.entries(cache)) if (live.has(id)) next[id] = v      // a deleted conversation drops out
  const stale = threads.filter(t => !next[t.id] || next[t.id].at !== t.at)
  let read = 0
  const size = o.chunk ?? 40
  for (let i = 0; i < stale.length; i += size) {
    if (o.within && !o.within()) return { cache: next, done: false, read, threads: threads.length }
    const part = stale.slice(i, i + size)
    const days = await mapPool(part, EUKA_CONCURRENCY, t => readThreadDays(e, t.id))
    part.forEach((t, k) => { next[t.id] = { at: t.at, days: days[k] } })
    read += part.length
    if (o.onChunk) await o.onChunk(next)
  }
  return { cache: next, done: true, read, threads: threads.length }
}

/**
 * Value for a period. Before the first Euka Chat message ever sent there is no data (null). From then on a period
 * with no team messages is a real 0.
 */
export function eukaChatFor(cache: ChatCache): (a: string, b: string) => number | null {
  const daily: Record<string, number> = {}
  for (const t of Object.values(cache)) for (const [d, n] of Object.entries(t.days)) daily[d] = (daily[d] ?? 0) + n
  const first = Object.keys(daily).sort()[0] ?? null
  return (a, b) => {
    if (!first || b < first) return null
    let total = 0
    for (let d = a; d <= b; d = addDays(d, 1)) total += daily[d] ?? 0
    return total
  }
}
