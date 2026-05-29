export interface TierData {
  creators: number
  newCreators: number
  videos: number
  gmv: number
  msgs: number
  msgsPct: number
  samples: number
  samplesPct: number
}

export interface D30Data {
  gmv: number
  gmvPct: number
  orders: number
  ordersPct: number
  videos: number
  videosPct: number
  views: number
  viewsPct: number
  creators: number
  creatorsPct: number
  newCreators: number
  newCreatorsPct: number
  retention: number
  retentionDelta: number
  gmvMax: { spend: number; revenue: number; roi: number }
  msgs: number
  msgsPct: number
  samples: number
  samplesPct: number
  tiers: { g1: TierData; g2: TierData; g3: TierData }
}

export interface WeeklyCharts {
  labels: string[]
  gmv: number[]
  views: number[]
  crg1: number[]; crg2: number[]; crg3: number[]
  ncg1: number[]; ncg2: number[]; ncg3: number[]
  vg1: number[];  vg2: number[];  vg3: number[]
  gg1: number[];  gg2: number[];  gg3: number[]
  ret: number[]
  vid: number[]
  mg1: number[]; mg2: number[]; mg3: number[]
  sg1: number[]; sg2: number[]; sg3: number[]
}

export interface MonthlyCharts {
  labels: string[]
  gmv: number[]
  views: number[]
  crg1: number[]; crg2: number[]; crg3: number[]
  ncg1: number[]; ncg2: number[]; ncg3: number[]
  vg1: number[];  vg2: number[];  vg3: number[]
  gg1: number[];  gg2: number[];  gg3: number[]
  ret: number[]
  mg1: number[]; mg2: number[]; mg3: number[]
  sg1: number[]; sg2: number[]; sg3: number[]
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
  monthlyVideosG1Target?: number; monthlyVideosG2Target?: number; monthlyVideosG3Target?: number
  // Samples per month
  monthlySamplesTarget?: number;  monthlySamplesPeriod?: string
  // GMV Max Spend
  monthlyGmvMaxSpendTarget?: number;    monthlyGmvMaxSpendPeriod?: string
  quarterlyGmvMaxSpendTarget?: number;  quarterlyGmvMaxSpendPeriod?: string
  // GMV Max ROI
  monthlyGmvMaxRoiTarget?: number;    monthlyGmvMaxRoiPeriod?: string
  quarterlyGmvMaxRoiTarget?: number;  quarterlyGmvMaxRoiPeriod?: string
  // Active creators (30-day) per tier
  activeG1Target?: number; activeG2Target?: number; activeG3Target?: number
  // Legacy fields (kept for backward compat)
  weeklyVideosTarget?: number
  weeklyVideosG1Target?: number; weeklyVideosG2Target?: number; weeklyVideosG3Target?: number
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
