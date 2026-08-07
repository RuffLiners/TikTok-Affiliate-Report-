// *Pct fields are % change vs the prior window, 1 decimal; null when the
// prior value was 0 (no meaningful delta — the UI shows a neutral state)
export interface TierData {
  creators: number
  newCreators: number
  videos: number
  views: number
  gmv: number
  gmvMaxSpend?: number
  gmvMaxRoi?: number
  msgs: number
  msgsPct: number | null
  samples: number
  samplesPct: number | null
}

export interface D30Data {
  gmv: number        // affiliate GMV from creator_store_performance (backward compat)
  gmvPct: number | null
  shopGmv?: number   // total/account GMV from get_dashboard_performance_overview (totalShopGMV)
  shopGmvPct?: number | null // change vs prior window (totalShopGMVDifference)
  affiliateGmv?: number     // affiliate-only from get_dashboard_performance_overview (totalAffiliateGMV)
  affiliateGmvPct?: number | null
  totalGmv?: number  // legacy alias for shopGmv (kept for backward compat)
  orders: number
  ordersPct: number | null
  videos: number
  videosPct: number | null
  views: number
  viewsPct: number | null
  creators: number
  creatorsPct: number | null
  newCreators: number
  newCreatorsPct: number | null
  retention: number
  retentionDelta: number
  gmvMax: { spend: number; revenue: number; roi: number }
  gmvMaxByAge?: Array<{ label: string; videos: number; spend: number; revenue: number; roi: number; pct: number }>
  msgs: number
  msgsPct: number | null
  samples: number
  samplesPct: number | null
  tiers: { l1: TierData; l2: TierData; l3: TierData; l4: TierData; l5: TierData; l6: TierData; l7: TierData }
}

export interface WeeklyCharts {
  labels: string[]
  gmv: number[]
  views: number[]
  crl1: number[]; crl2: number[]; crl3: number[]; crl4: number[]; crl5: number[]; crl6: number[]; crl7: number[]
  ncl1: number[]; ncl2: number[]; ncl3: number[]; ncl4: number[]; ncl5: number[]; ncl6: number[]; ncl7: number[]
  vl1: number[];  vl2: number[];  vl3: number[];  vl4: number[];  vl5: number[];  vl6: number[];  vl7: number[]
  gl1: number[];  gl2: number[];  gl3: number[];  gl4: number[];  gl5: number[];  gl6: number[];  gl7: number[]
  vwl1: number[]; vwl2: number[]; vwl3: number[]; vwl4: number[]; vwl5: number[]; vwl6: number[]; vwl7: number[]
  ret: number[]
  vid: number[]
  ml1: number[]; ml2: number[]; ml3: number[]; ml4: number[]; ml5: number[]; ml6: number[]; ml7: number[]
  sl1: number[]; sl2: number[]; sl3: number[]; sl4: number[]; sl5: number[]; sl6: number[]; sl7: number[]
  sal1?: number[]; sal2?: number[]; sal3?: number[]; sal4?: number[]; sal5?: number[]; sal6?: number[]; sal7?: number[]
}

export interface MonthlyCharts {
  labels: string[]
  gmv: number[]
  shopGmv?: number[]      // total account GMV per month (contract key)
  affiliateGmv?: number[] // affiliate GMV per month (same values as gmv)
  totalGmv?: number[]     // legacy alias for shopGmv
  views: number[]
  crl1: number[]; crl2: number[]; crl3: number[]; crl4: number[]; crl5: number[]; crl6: number[]; crl7: number[]
  ncl1: number[]; ncl2: number[]; ncl3: number[]; ncl4: number[]; ncl5: number[]; ncl6: number[]; ncl7: number[]
  vl1: number[];  vl2: number[];  vl3: number[];  vl4: number[];  vl5: number[];  vl6: number[];  vl7: number[]
  gl1: number[];  gl2: number[];  gl3: number[];  gl4: number[];  gl5: number[];  gl6: number[];  gl7: number[]
  vwl1: number[]; vwl2: number[]; vwl3: number[]; vwl4: number[]; vwl5: number[]; vwl6: number[]; vwl7: number[]
  ret: number[]
  ml1: number[]; ml2: number[]; ml3: number[]; ml4: number[]; ml5: number[]; ml6: number[]; ml7: number[]
  sl1: number[]; sl2: number[]; sl3: number[]; sl4: number[]; sl5: number[]; sl6: number[]; sl7: number[]
  sal1?: number[]; sal2?: number[]; sal3?: number[]; sal4?: number[]; sal5?: number[]; sal6?: number[]; sal7?: number[]
}

export interface Creator {
  h: string; flw: number; sgmv: number; ggmv: number
  views: number; v30: number; vmgmv: number; vlife: number
  v7: number; ord: number; aov: number; eng: number | null; active: boolean
}

export interface Video {
  h: string; ggmv: number; prod: string; gmv: number
  views: number; ord: number; aov: number; likes: number
  cmt: number; clicks: number | null; date: string
}

export interface ActiveCreator {
  h: string; ggmv: number; flw: number; v30: number
  gmvN: number; gmvT: number; views: number; avgv: number; ord: number
}

export interface WeeklyCreatorRow {
  h: string; ggmv: number; gmv: number; views: number
  vid: number; ord: number; aov: number
}

export interface ReportTables {
  topCreators: Creator[]
  topVideos: Video[]
  activeCreators: ActiveCreator[]
  weeklyTopCreators?: WeeklyCreatorRow[]
  weeklyTopVideos?: Video[]
  weeklyActiveCreators?: WeeklyCreatorRow[]
}

export interface Goals {
  // Revenue
  monthlyGmvTarget?: number;    monthlyPeriod?: string
  quarterlyGmvTarget?: number;  quarterlyPeriod?: string
  // Videos per month
  monthlyVideosTarget?: number;   monthlyVideosPeriod?: string
  monthlyVideosL1Target?: number; monthlyVideosL2Target?: number; monthlyVideosL3Target?: number; monthlyVideosL4Target?: number; monthlyVideosL5Target?: number; monthlyVideosL6Target?: number; monthlyVideosL7Target?: number
  // Samples per month
  monthlySamplesTarget?: number;  monthlySamplesPeriod?: string
  // GMV Max Spend
  monthlyGmvMaxSpendTarget?: number;    monthlyGmvMaxSpendPeriod?: string
  quarterlyGmvMaxSpendTarget?: number;  quarterlyGmvMaxSpendPeriod?: string
  // GMV Max ROI
  monthlyGmvMaxRoiTarget?: number;    monthlyGmvMaxRoiPeriod?: string
  quarterlyGmvMaxRoiTarget?: number;  quarterlyGmvMaxRoiPeriod?: string
  // Active creators (30-day) per tier
  activeL1Target?: number; activeL2Target?: number; activeL3Target?: number; activeL4Target?: number; activeL5Target?: number; activeL6Target?: number; activeL7Target?: number
  // Legacy fields (kept for backward compat)
  weeklyVideosTarget?: number
  weeklyVideosL1Target?: number; weeklyVideosL2Target?: number; weeklyVideosL3Target?: number; weeklyVideosL4Target?: number; weeklyVideosL5Target?: number; weeklyVideosL6Target?: number; weeklyVideosL7Target?: number
}

export interface WeeklyReport {
  id: string
  report_date: string
  label: string
  data_window: string
  created_at: string
  d30: D30Data
  weekly_charts: WeeklyCharts
  monthly_charts: MonthlyCharts
  tables: ReportTables
  agents?: OutreachAgentRow[]
  analysis?: {
    performance?: string
    creators?: string
    recruiting?: string
    growth?: string
    d30?: string
    weekly?: string
    monthly?: string
  }
}

export interface OutreachAgentRow {
  id: number
  name: string
  agent_type: 'outreach' | 'crm'
  campaign_type: string
  status: 'running' | 'stopped' | 'error'
  date_posted: string
  // exact spreadsheet columns
  gmv_filter: string           // "GMV Filter" e.g. "$2.5K–$2M" or "none"
  kw_filter: string            // "KW / Search Filter" e.g. '"vehicle"' or "—"
  other_filters: string        // "Other Attribute Filters"
  list_segment: string         // "List / Segment"
  commission_display: string   // "Organic & Ads Comm." e.g. "20% / 10%"
  creators_reached: number     // Conversations
  remaining: number            // Remaining Creators
  total_invites: number        // Target Invites
  accepted_invites: number     // Accepted Invites
  total_replies: number        // Replies
  samples_requested: number    // Sample Requests
  samples_shipped: number      // Samples Shipped
  total_videos: number         // Videos
  total_revenue: number        // Revenue ($)
  product_count: number        // Products (count)
  has_followups: boolean       // Has Followups
  // legacy / detail fields (may be empty when using list-only fetch)
  post_rate: number
  use_ai_personalization: boolean
  daily_limit: number | null
  targeting_method: string
  target_categories: string[]
  target_gmvs: string[]
  target_avg_views: string[]
  target_followers: string[]
  target_gender: string | null
  target_engagement: number | null
  free_samples: boolean
  commission: { productId: string; rate: number }[]
  products: { id: string; title: string }[]
  message: string
  collab_message: string
}

export interface ReportMeta {
  report_date: string
  label: string
  data_window: string
  created_at: string
  d30_gmv: number
}
