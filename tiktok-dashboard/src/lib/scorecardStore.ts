import { supabaseAdmin } from '@/lib/supabase'
import { buildScorecard, auditScorecard, ManualEntry, Scorecard, ScorecardRaw } from '@/lib/scorecard'

export interface LoadedScorecard {
  scorecard: Scorecard
  publishedAudit: { status: string; failures?: string[]; warnings?: string[] } | null
  publishedAt: string | null
  /** Audit of the page's current rebuild (includes manual entries). */
  liveAudit: ReturnType<typeof auditScorecard>
}

export async function loadManualEntries(): Promise<ManualEntry[]> {
  const { data, error } = await supabaseAdmin().from('scorecard_manual').select('*')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: any) => ({ ...r, value: Number(r.value) })) as ManualEntry[]
}

/** Latest published scorecard, rebuilt from its raw pulls plus the current manual entries. */
export async function loadLatestScorecard(): Promise<LoadedScorecard | null> {
  const supabase = supabaseAdmin()
  const { data: row, error } = await supabase.from('scorecards').select('*').order('as_of', { ascending: false }).limit(1).maybeSingle()
  if (error || !row) return null
  const manual = await loadManualEntries().catch(() => [] as ManualEntry[])
  const scorecard = buildScorecard(row.raw as ScorecardRaw, manual)
  return { scorecard, publishedAudit: row.audit ?? null, publishedAt: row.created_at ?? null, liveAudit: auditScorecard(scorecard) }
}
