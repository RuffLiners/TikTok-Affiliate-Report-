import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

// ─── PASTE THIS WEEK'S DATA HERE ──────────────────────────
// Paste the JSON output of setup-kit/weekly-report-prompt.md.
// Creator tiers use Euka levels: L1 <$5K, L2 $5K–$25K, L3 $25K–$60K,
// L4 $60K–$150K, L5 $150K–$400K, L6 $400K–$1.5M, L7 $1.5M+
const REPORT_DATA = {
  meta: {
    reportDate: 'YYYY-MM-DD',
    label: 'Month D, YYYY',
    dataWindow: 'Mon D – Mon D, YYYY'
  },
  d30: {
    gmv:0, gmvPct:0, shopGmv:0, shopGmvPct:0, affiliateGmv:0, affiliateGmvPct:0,
    orders:0, ordersPct:0,
    videos:0, videosPct:0, views:0, viewsPct:0,
    creators:0, creatorsPct:0, newCreators:0, newCreatorsPct:0,
    retention:0, retentionDelta:0,
    gmvMax:{ spend:0, revenue:0, roi:0 },
    gmvMaxByAge:[],
    msgs:0, msgsPct:0, samples:0, samplesPct:0,
    tiers:{
      l1:{ creators:0, newCreators:0, videos:0, views:0, gmv:0, msgs:0, msgsPct:0, samples:0, samplesPct:0 },
      l2:{ creators:0, newCreators:0, videos:0, views:0, gmv:0, msgs:0, msgsPct:0, samples:0, samplesPct:0 },
      l3:{ creators:0, newCreators:0, videos:0, views:0, gmv:0, msgs:0, msgsPct:0, samples:0, samplesPct:0 },
      l4:{ creators:0, newCreators:0, videos:0, views:0, gmv:0, msgs:0, msgsPct:0, samples:0, samplesPct:0 },
      l5:{ creators:0, newCreators:0, videos:0, views:0, gmv:0, msgs:0, msgsPct:0, samples:0, samplesPct:0 },
      l6:{ creators:0, newCreators:0, videos:0, views:0, gmv:0, msgs:0, msgsPct:0, samples:0, samplesPct:0 },
      l7:{ creators:0, newCreators:0, videos:0, views:0, gmv:0, msgs:0, msgsPct:0, samples:0, samplesPct:0 }
    }
  },
  weeklyCharts:{
    labels:[],
    gmv:[], views:[],
    crl1:[],crl2:[],crl3:[],crl4:[],crl5:[],crl6:[],crl7:[],
    ncl1:[],ncl2:[],ncl3:[],ncl4:[],ncl5:[],ncl6:[],ncl7:[],
    vl1:[],vl2:[],vl3:[],vl4:[],vl5:[],vl6:[],vl7:[],
    gl1:[],gl2:[],gl3:[],gl4:[],gl5:[],gl6:[],gl7:[],
    vwl1:[],vwl2:[],vwl3:[],vwl4:[],vwl5:[],vwl6:[],vwl7:[],
    ret:[], vid:[],
    ml1:[],ml2:[],ml3:[],ml4:[],ml5:[],ml6:[],ml7:[],
    sl1:[],sl2:[],sl3:[],sl4:[],sl5:[],sl6:[],sl7:[]
  },
  monthlyCharts:{
    labels:[],
    gmv:[], shopGmv:[], affiliateGmv:[], views:[],
    crl1:[],crl2:[],crl3:[],crl4:[],crl5:[],crl6:[],crl7:[],
    ncl1:[],ncl2:[],ncl3:[],ncl4:[],ncl5:[],ncl6:[],ncl7:[],
    vl1:[],vl2:[],vl3:[],vl4:[],vl5:[],vl6:[],vl7:[],
    gl1:[],gl2:[],gl3:[],gl4:[],gl5:[],gl6:[],gl7:[],
    vwl1:[],vwl2:[],vwl3:[],vwl4:[],vwl5:[],vwl6:[],vwl7:[],
    ret:[],
    ml1:[],ml2:[],ml3:[],ml4:[],ml5:[],ml6:[],ml7:[],
    sl1:[],sl2:[],sl3:[],sl4:[],sl5:[],sl6:[],sl7:[],
    sal1:[],sal2:[],sal3:[],sal4:[],sal5:[],sal6:[],sal7:[]
  },
  tables:{
    topCreators:[],
    topVideos:[],
    activeCreators:[],
    weeklyTopCreators:[],
    weeklyTopVideos:[],
    weeklyActiveCreators:[]
  }
}
// ──────────────────────────────────────────────────────────

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  )

  const { error } = await supabase
    .from('weekly_reports')
    .upsert({
      report_date: REPORT_DATA.meta.reportDate,
      label: REPORT_DATA.meta.label,
      data_window: REPORT_DATA.meta.dataWindow,
      d30: REPORT_DATA.d30,
      weekly_charts: REPORT_DATA.weeklyCharts,
      monthly_charts: REPORT_DATA.monthlyCharts,
      tables: REPORT_DATA.tables,
      agents: (REPORT_DATA as any).agents ?? [],
      analysis: (REPORT_DATA as any).analysis ?? {}
    }, { onConflict: 'report_date' })

  if (error) {
    console.error('❌ Insert failed:', error.message)
    process.exit(1)
  }

  console.log(`✅ Report saved: ${REPORT_DATA.meta.label}`)
  console.log(`   Data window: ${REPORT_DATA.meta.dataWindow}`)
  console.log(`   GMV: $${Math.round(REPORT_DATA.d30.gmv).toLocaleString()}`)
}

main()
