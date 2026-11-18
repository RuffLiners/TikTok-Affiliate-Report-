// SKILL.md Phase 2 steps 7 and 8: the agent listing and get_outreach_agent enrichment, mapped to the dashboard's
// OutreachAgentRow. A field that could not be read is "not enriched"; "none" / "—" only when it was read and empty.
import { laDate } from './windows.js'

export const NOT_ENRICHED = 'not enriched'
const trunc = (s: string, n = 40) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const nonEmpty = (v: unknown) => v !== null && v !== undefined && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0) && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0)

export interface Enrichment { gmv_filter: string; kw_filter: string; other_filters: string; list_segment: string; commission_display: string; product_count: number | null }

/** Audience fields that are not GMV or keyword/category and not collab settings. */
const SKIP = new Set(['target_gmvs', 'target_categories'])
const fmt = (v: unknown): string => Array.isArray(v) ? v.map(fmt).join(', ') : v && typeof v === 'object' ? JSON.stringify(v) : String(v)

export function enrich(detail: any): Enrichment {
  const c = detail?.campaign
  if (!c || typeof c !== 'object') throw new Error('get_outreach_agent returned no campaign')
  const gmvs: string[] = Array.isArray(c.target_gmvs) ? c.target_gmvs.map(String) : []
  const cats: string[] = Array.isArray(c.target_categories) ? c.target_categories.map(String) : []
  const other = Object.entries(c)
    .filter(([k, v]) => k.startsWith('target_') && !k.startsWith('target_collab_') && !SKIP.has(k) && nonEmpty(v))
    .map(([k, v]) => `${k.slice(7).replace(/_/g, ' ')}: ${fmt(v)}`)
  const names = [...(detail.lists ?? []), ...(detail.legacyLists ?? []), ...(detail.segments ?? [])]
    .map((x: any) => (typeof x === 'string' ? x : x?.name ?? x?.title ?? x?.id ?? '')).filter(Boolean).map((x: string) => trunc(String(x)))
  const pct = (xs: any[] | null | undefined) => [...new Set((xs ?? []).map((x: any) => Number(x?.commission)).filter(n => Number.isFinite(n)))].sort((a, b) => b - a).map(n => `${n}%`).join('/')
  const organic = pct(c.product_commission_with_percentage)
  const ads = c.include_shop_ads ? pct(c.shop_ads_commission) : ''
  const products = Array.isArray(c.products) ? c.products.length : Array.isArray(detail.products) ? detail.products.length : null
  return {
    gmv_filter: gmvs.length ? gmvs.join(', ') : 'none',
    kw_filter: cats.length ? cats.join(', ') : 'none',
    other_filters: other.length ? other.join('; ') : 'none',
    list_segment: names.length ? names.join(', ') : 'none',
    commission_display: organic ? (ads ? `${organic} / ${ads}` : organic) : 'none',
    product_count: products,
  }
}

export const UNENRICHED: Enrichment = { gmv_filter: NOT_ENRICHED, kw_filter: NOT_ENRICHED, other_filters: NOT_ENRICHED, list_segment: NOT_ENRICHED, commission_display: NOT_ENRICHED, product_count: null }

/** A listing row plus its enrichment, as the dashboard stores it. */
export function agentRow(a: any, type: 'outreach' | 'crm', e: Enrichment) {
  const n = (v: unknown) => Number(v ?? 0) || 0
  return {
    id: Number(a.id), name: String(a.campaign_name ?? a.name ?? ''), agent_type: type, campaign_type: String(a.campaign_type ?? ''),
    status: String(a.bot_status ?? ''), date_posted: laDate(String(a.created_time)),
    gmv_filter: e.gmv_filter, kw_filter: e.kw_filter, other_filters: e.other_filters, list_segment: e.list_segment, commission_display: e.commission_display,
    creators_reached: n(a.total_conversations), remaining: n(a.remaining_creators), total_invites: n(a.total_target_invites),
    accepted_invites: n(a.total_target_accepted_invites), total_replies: n(a.total_replies), samples_requested: n(a.total_sample_request),
    samples_shipped: n(a.total_samples_shipped), total_videos: n(a.total_videos), total_revenue: n(a.total_revenue),
    product_count: e.product_count ?? (Array.isArray(a.products) ? a.products.length : 0), has_followups: !!a.has_followups, post_rate: n(a.post_rate),
  }
}

/** Keep agents created inside the window (Pacific dates), newest first, one row per id. */
export function inWindow(rows: Array<{ a: any; type: 'outreach' | 'crm' }>, start: string, end: string) {
  const seen = new Set<number>()
  return rows
    .filter(({ a }) => { const d = laDate(String(a.created_time)); return d >= start && d <= end })
    .filter(({ a }) => (seen.has(Number(a.id)) ? false : (seen.add(Number(a.id)), true)))
    .sort((x, y) => String(y.a.created_time).localeCompare(String(x.a.created_time)))
}
