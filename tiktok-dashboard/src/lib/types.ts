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

export interface ReportTables {
  topCreators: Creator[]
  topVideos: Video[]
  activeCreators: ActiveCreator[]
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
  analysis?: {
    d30: string
    weekly: string
    monthly: string
  }
}

export interface ReportMeta {
  report_date: string
  label: string
  data_window: string
  created_at: string
  d30_gmv: number
}
