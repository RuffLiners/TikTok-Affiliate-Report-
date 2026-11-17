// Scorecard types. Dependency-free (relative imports only) so the Next app,
// the Monday pipeline and the tests all run the exact same code.

export type LineKey =
  | 'grossRevenue' | 'gmv' | 'gmvCofunded' | 'gmvMaxSpend' | 'gmvMaxRoi'
  | 'targetInvites' | 'eukaMessages' | 'emails' | 'samplesApproved'
  | 'creatorsPosted' | 'videos' | 'views' | 'contestAffiliates' | 'usageRightsCreators'

export type Source = 'euka' | 'seller_center' | 'manual' | 'none'
export type LineKind = 'money' | 'count' | 'ratio'

export interface LineDef {
  n: number
  key: LineKey
  label: string
  kind: LineKind
  /** Counts of distinct people: never summed across periods, never projected. */
  distinct?: boolean
  /** Ratio computed from other lines, never summed or averaged. */
  derived?: boolean
  /** Entered by hand from Seller Center: Euka has no equivalent field. Only line 3. */
  sellerCenter?: boolean
}

export const LINES: LineDef[] = [
  { n: 1,  key: 'grossRevenue',        label: 'TikTok Gross Revenue',                    kind: 'money' },
  { n: 2,  key: 'gmv',                 label: 'TikTok GMV',                              kind: 'money' },
  { n: 3,  key: 'gmvCofunded',         label: 'TikTok GMV with TikTok co-funding',       kind: 'money', sellerCenter: true },
  { n: 4,  key: 'gmvMaxSpend',         label: 'TikTok GMV Max Spend',                    kind: 'money' },
  { n: 5,  key: 'gmvMaxRoi',           label: 'TikTok GMV Max ROI',                      kind: 'ratio', derived: true },
  { n: 6,  key: 'targetInvites',       label: 'Euka Outreach: Target Collab invites sent', kind: 'count' },
  { n: 7,  key: 'eukaMessages',        label: 'Euka Outreach: Euka Chat messages sent',  kind: 'count' },
  { n: 8,  key: 'emails',              label: 'Euka Outreach: Emails sent',              kind: 'count' },
  { n: 9,  key: 'samplesApproved',     label: 'Free Samples Approved',                   kind: 'count' },
  { n: 10, key: 'creatorsPosted',      label: 'Creators Posted',                         kind: 'count', distinct: true },
  { n: 11, key: 'videos',              label: 'Affiliate Videos Posted',                 kind: 'count' },
  { n: 12, key: 'views',               label: 'Views',                                   kind: 'count' },
  { n: 13, key: 'contestAffiliates',   label: 'Affiliates in Monthly Contest',           kind: 'count', distinct: true },
  { n: 14, key: 'usageRightsCreators', label: 'Affiliates with Usage Rights Authorized', kind: 'count', distinct: true },
]
export const LINE_KEYS = LINES.map(l => l.key)
export const LINE_BY_KEY = Object.fromEntries(LINES.map(l => [l.key, l])) as Record<LineKey, LineDef>
/** Lines that can be summed across days and projected to month end. */
export const ADDITIVE_KEYS: LineKey[] = LINES.filter(l => !l.distinct && !l.derived).map(l => l.key)
/**
 * Lines a person may enter or import. gmvCofunded is the only line with no Euka source. The others are
 * history fill: used only for periods where Euka returns nothing (before its retention window).
 */
export const MANUAL_KEYS: LineKey[] = ['gmvCofunded', 'grossRevenue', 'gmv', 'views', 'eukaMessages']
/** Seller Center values entered for the monthly spot-check against Euka. They never replace a Euka cell. */
export const CHECK_ONLY_KEYS: LineKey[] = ['grossRevenue', 'gmv', 'gmvMaxSpend', 'gmvMaxRoi']
export const SELLER_CENTER_KEYS: LineKey[] = ['gmvCofunded']

export const LAUNCH_DATE = '2025-10-01'
export const LAUNCH_MONTH = '2025-10'

/** Raw numbers for one period as the source returned them. null = source had no data. */
export interface RangeRaw {
  shopGmv?: number | null
  gmvMaxSpend?: number | null
  gmvMaxRevenue?: number | null
  targetInvites?: number | null
  eukaMessages?: number | null
  emails?: number | null
  samplesApproved?: number | null
  creatorsPosted?: number | null
  videos?: number | null
  views?: number | null
  contestAffiliates?: number | null
  usageRightsCreators?: number | null
}

export interface ScorecardRaw {
  asOf: string          // report date, YYYY-MM-DD, America/Los_Angeles
  /** When set, weekly history covers every complete week back to the week containing this date (e.g. 2026-01-01). */
  yearStart?: string
  dataThrough: string   // last day with complete data
  weeks: Record<string, RangeRaw>   // keyed by week start (Sunday)
  months: Record<string, RangeRaw>  // keyed by YYYY-MM, month to date for the current one
  allTime: RangeRaw
  /** Optional daily series (spend, revenue, views) used by the audit to prove weekly and monthly agree. */
  daily?: Record<string, { gmvMaxSpend?: number | null; gmvMaxRevenue?: number | null; views?: number | null }>
  /** Source caveats from the pull (definition differences, fallbacks). Shown in the issues list. */
  notes?: string[]
}

export interface ManualEntry {
  period_type: 'week' | 'month' | 'month_check'
  period_key: string        // week start (Sunday) or YYYY-MM (month_check: the month being spot-checked)
  line: LineKey
  value: number
  source: 'manual' | 'seller_center'
  entered_by?: string | null
  entered_at?: string | null
}

export interface Cell {
  value: number | null
  source: Source
  confirmed: boolean
  note?: string
  enteredBy?: string
  enteredAt?: string
}
export type Lines = Record<LineKey, Cell>

export interface PeriodBase {
  key: string
  label: string
  start: string
  end: string
  lines: Lines
  /** GMV Max attributed revenue, the numerator of line 5. */
  gmvMaxRevenue: number | null
  /** shop GMV / spend. Shown beside ROI so a revenue figure above shop GMV is visible. */
  roiVsShopGmv: number | null
}
export interface WeekPeriod extends PeriodBase {
  /** Percent change vs the prior week, per line. null where either side has no data. */
  changes: Record<LineKey, number | null>
  prior: Record<LineKey, number | null>
}
export interface MonthPeriod extends PeriodBase {
  partial: boolean
  daysElapsed: number
  daysInMonth: number
  mtd: Record<LineKey, number | null>
  /** Straight-line month-end estimate. null for distinct-people lines, no-data lines and complete months. */
  projected: Record<LineKey, number | null> | null
  projectedGmvMaxRevenue: number | null
  projectedRoiVsShopGmv: number | null
}
export type AllTimePeriod = PeriodBase

export interface Issue {
  id: string
  severity: 'warn' | 'info'
  line?: LineKey
  text: string
}

export interface SellerCenterCheckRow {
  line: 'grossRevenue' | 'gmv' | 'gmvMaxSpend' | 'gmvMaxRoi'
  period: string
  euka: number | null
  sellerCenter: number | null
  diff: number | null
  pctDiff: number | null
  flag: boolean
  status: 'compared' | 'no_seller_center_value' | 'no_euka_value'
}

export interface Scorecard {
  version: 1
  asOf: string
  dataThrough: string
  allTime: AllTimePeriod
  weekly: WeekPeriod[]
  /** Every complete week from yearStart, newest first. The first 13 equal `weekly`. Present when raw.yearStart is set. */
  weeklyAll?: WeekPeriod[]
  monthly: MonthPeriod[]
  issues: Issue[]
  sellerCenterCheck: { period: string; thresholdPct: number; rows: SellerCenterCheckRow[]; flagged: number }
  daily?: ScorecardRaw['daily']
}
