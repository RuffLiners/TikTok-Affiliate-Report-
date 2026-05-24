import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

// ─── PASTE THIS WEEK'S DATA HERE ──────────────────────────
const REPORT_DATA = {
  meta: {
    reportDate: '2026-05-27',
    label: 'May 27, 2026',
    dataWindow: 'Apr 25 – May 22, 2026'
  },
  d30: {
    gmv:169119, gmvPct:141.5, orders:1044, ordersPct:126.5,
    videos:541, videosPct:11.5, views:1254542, viewsPct:-79.6,
    creators:121, creatorsPct:0, newCreators:73, newCreatorsPct:-8.8,
    retention:28.93, retentionDelta:-2.94,
    gmvMax:{ spend:12975, revenue:40611, roi:3.13 },
    msgs:92702, msgsPct:106.9, samples:76, samplesPct:0,
    tiers:{
      g1:{ creators:71, newCreators:44, videos:306, gmv:25954, msgs:15370, msgsPct:13.4, samples:20, samplesPct:-50 },
      g2:{ creators:38, newCreators:24, videos:137, gmv:50271, msgs:69193, msgsPct:277.3, samples:47, samplesPct:88 },
      g3:{ creators:12, newCreators:5, videos:98, gmv:92587, msgs:8139, msgsPct:-37, samples:9, samplesPct:-18.2 }
    }
  },
  weeklyCharts:{
    labels:['2/15','2/22','3/1','3/8','3/15','3/22','3/29','4/5','4/12','4/19','4/26','5/3','5/10'],
    gmv:[19257,19898,21333,18596,10812,16208,17213,17604,14404,18391,52541,48198,25628],
    views:[475960,523623,159652,212543,104769,318022,1373954,143918,4240050,359192,270141,247113,200974],
    crg1:[16,22,25,18,21,19,30,26,27,19,27,26,22],crg2:[8,8,9,6,9,16,15,10,8,11,9,12,16],crg3:[4,3,0,2,2,2,2,4,7,6,3,3,6],
    ncg1:[4,8,9,6,10,8,13,11,11,6,13,11,8],ncg2:[3,4,4,1,4,9,7,3,3,5,5,4,9],ncg3:[3,2,0,1,1,2,2,3,4,3,0,1,2],
    vg1:[72,105,83,89,80,62,78,62,66,64,78,78,64],vg2:[24,27,15,12,19,54,47,28,18,24,40,29,25],vg3:[6,4,0,7,2,2,3,13,16,21,18,23,25],
    gg1:[430,5313,955,1453,0,637,15244,170,340,170,2360,2801,960],gg2:[9250,7655,1719,3362,3756,10868,22109,5409,299,1749,2691,1308,484],gg3:[190,1337,0,1253,0,0,7977,700,75883,3857,682,380,3147],
    ret:[40.6,32.1,36.4,44.1,42.3,34.4,37.8,34.0,42.5,38.1,38.9,35.9,36.6],
    vid:[102,136,98,108,101,118,128,103,100,109,136,130,114],
    mg1:[1237,0,6877,20466,14543,3025,3143,1716,3059,3515,3678,4708,4659],mg2:[2951,0,5036,1680,2807,1111,7015,1649,3788,5614,9972,19682,23241],mg3:[1392,0,1528,630,1078,400,3512,2303,2977,3975,3934,1028,711],
    sg1:[7,6,8,14,27,13,8,8,7,6,7,7,3],sg2:[6,8,10,12,7,4,3,9,6,8,4,22,9],sg3:[1,1,2,3,1,2,1,5,3,0,4,2,2]
  },
  monthlyCharts:{
    labels:['Dec','Jan','Feb','Mar','Apr','May*'],
    gmv:[65154,70346,78589,76363,93558,122954],
    views:[12969948,5971370,1784572,1308033,5834108,765137],
    crg1:[49,63,47,62,77,54],crg2:[14,17,28,32,29,34],crg3:[5,6,10,7,14,7],
    ncg1:[37,49,22,39,47,29],ncg2:[14,11,22,22,18,20],ncg3:[4,5,7,5,11,3],
    vg1:[346,397,295,346,301,213],vg2:[43,55,93,129,117,98],vg3:[6,36,20,12,67,70],
    gg1:[18693,19659,17909,15678,10984,19960],gg2:[45074,35778,44134,50305,44299,36728],gg3:[1387,14909,16547,10380,38275,66267],
    ret:[14.7,20.9,30.6,26.7,28.3,31.6],
    mg1:[0,0,3181,46147,12235,12073],mg2:[0,0,3577,13471,19873,63361],mg3:[0,0,1739,5215,14731,4240],
    sg1:[43,23,16,64,33,13],sg2:[19,40,19,33,30,39],sg3:[4,10,8,9,10,7]
  },
  tables:{
    topCreators:[
      {h:'tiktokshopdeals4you',flw:19559,sgmv:80048,ggmv:156694,views:205830,v30:69,vmgmv:12,vlife:78,v7:17,ord:462,aov:173.26,eng:0.38,active:true},
      {h:'lifewithgingy',flw:9121,sgmv:19697,ggmv:58293,views:94174,v30:30,vmgmv:8,vlife:124,v7:7,ord:153,aov:128.74,eng:0.17,active:true},
      {h:'markandgemma',flw:108994,sgmv:12818,ggmv:12305,views:107375,v30:30,vmgmv:5,vlife:127,v7:10,ord:77,aov:166.46,eng:0.42,active:true},
      {h:'richbychriss',flw:4352,sgmv:11668,ggmv:73659,views:15282,v30:6,vmgmv:2,vlife:18,v7:0,ord:71,aov:164.33,eng:0.04,active:true},
      {h:'michellepearlpnw',flw:18504,sgmv:11636,ggmv:36680,views:131586,v30:18,vmgmv:4,vlife:57,v7:3,ord:73,aov:159.39,eng:0.28,active:true},
      {h:'mikeyandmandy_',flw:38761,sgmv:3979,ggmv:362917,views:125667,v30:0,vmgmv:2,vlife:18,v7:0,ord:25,aov:159.17,eng:0.37,active:false},
      {h:'officialwillygooddog',flw:365993,sgmv:3687,ggmv:4195,views:17898,v30:3,vmgmv:2,vlife:5,v7:0,ord:22,aov:167.61,eng:1.10,active:true},
      {h:'measuredmacros',flw:11467,sgmv:3424,ggmv:135291,views:39714,v30:16,vmgmv:1,vlife:32,v7:5,ord:21,aov:163.06,eng:0.38,active:true},
      {h:'phamsfinds',flw:5490,sgmv:2991,ggmv:59013,views:0,v30:0,vmgmv:0,vlife:10,v7:0,ord:19,aov:157.42,eng:null,active:false},
      {h:'nolangrabs',flw:65970,sgmv:1926,ggmv:283079,views:0,v30:0,vmgmv:0,vlife:15,v7:0,ord:11,aov:175.13,eng:null,active:false},
      {h:'mrs.williams11720',flw:10980,sgmv:1897,ggmv:4251,views:0,v30:0,vmgmv:0,vlife:1,v7:0,ord:11,aov:172.42,eng:null,active:false},
      {h:'dwa_dogswithattitude',flw:34695,sgmv:1821,ggmv:66475,views:5569,v30:4,vmgmv:1,vlife:15,v7:3,ord:10,aov:182.09,eng:0.65,active:true},
      {h:'subaki_the_pitty',flw:66138,sgmv:1351,ggmv:3980,views:69349,v30:48,vmgmv:4,vlife:81,v7:9,ord:8,aov:168.87,eng:0.52,active:true},
      {h:'sarahgibbons_',flw:243702,sgmv:1077,ggmv:852773,views:0,v30:0,vmgmv:0,vlife:3,v7:0,ord:6,aov:179.49,eng:null,active:false},
      {h:'reliable.rosalie',flw:10753,sgmv:894,ggmv:14619,views:19219,v30:23,vmgmv:2,vlife:23,v7:1,ord:6,aov:148.93,eng:1.08,active:true}
    ],
    topVideos:[
      {h:'tiktokshopdeals4you',ggmv:156694,prod:'Back Seat Ext.',gmv:2650.82,views:80138,ord:16,aov:165.68,likes:225,cmt:8,clicks:5,date:'May 11'},
      {h:'mikeyandmandy_',ggmv:362917,prod:'XL Floor Cover',gmv:1196.42,views:99290,ord:8,aov:149.55,likes:377,cmt:1,clicks:653,date:'Apr 23'},
      {h:'mikeyandmandy_',ggmv:362917,prod:'Back Seat Ext.',gmv:1159.93,views:26377,ord:7,aov:165.70,likes:79,cmt:2,clicks:0,date:'Apr 23'},
      {h:'lifewithgingy',ggmv:58293,prod:'Travel Dog Bed',gmv:1054.33,views:46200,ord:14,aov:75.31,likes:27,cmt:0,clicks:null,date:'Apr 24'},
      {h:'markandgemma',ggmv:12305,prod:'Back Seat Ext.',gmv:1042.18,views:62012,ord:6,aov:173.70,likes:250,cmt:18,clicks:10,date:'May 4'},
      {h:'michellepearlpnw',ggmv:36680,prod:'Back Seat Ext.',gmv:990.08,views:61352,ord:6,aov:165.01,likes:146,cmt:19,clicks:41,date:'Apr 30'},
      {h:'richbychriss',ggmv:73659,prod:'Back Seat Ext.',gmv:809.96,views:12664,ord:5,aov:161.99,likes:6,cmt:0,clicks:115,date:'May 8'},
      {h:'reliable.rosalie',ggmv:14619,prod:'Back Seat Ext.',gmv:723.56,views:8340,ord:5,aov:144.71,likes:13,cmt:1,clicks:0,date:'Apr 30'},
      {h:'michellepearlpnw',ggmv:36680,prod:'Back Seat Ext.',gmv:653.96,views:37658,ord:4,aov:163.49,likes:68,cmt:16,clicks:0,date:'Apr 29'},
      {h:'moonstonefool',ggmv:0,prod:'Back Seat Ext.',gmv:650.97,views:6253,ord:4,aov:162.74,likes:17,cmt:3,clicks:0,date:'May 1'},
      {h:'purplepuppies88',ggmv:0,prod:'Back Seat Ext.',gmv:642.11,views:9644,ord:4,aov:160.53,likes:1,cmt:1,clicks:231,date:'May 13'},
      {h:'tiktokshopdeals4you',ggmv:156694,prod:'Back Seat Ext.',gmv:624.96,views:9853,ord:4,aov:156.24,likes:16,cmt:0,clicks:0,date:'Apr 24'},
      {h:'goldendealsforyou',ggmv:0,prod:'Back Seat Ext.',gmv:602.84,views:102536,ord:4,aov:150.71,likes:460,cmt:2,clicks:17,date:'May 22'},
      {h:'kayceeinthehouse',ggmv:0,prod:'Back Seat Ext.',gmv:429.47,views:11338,ord:3,aov:143.16,likes:23,cmt:0,clicks:null,date:'Apr 28'},
      {h:'subaki_the_pitty',ggmv:3980,prod:'Back Seat Ext.',gmv:367.98,views:5863,ord:2,aov:183.99,likes:11,cmt:0,clicks:null,date:'May 3'}
    ],
    activeCreators:[
      {h:'tiktokshopdeals4you',ggmv:156694,flw:19559,v30:69,gmvN:5217,gmvT:80048,views:214024,avgv:3102,ord:462},
      {h:'subaki_the_pitty',ggmv:3980,flw:66138,v30:53,gmvN:1056,gmvT:1351,views:71106,avgv:1342,ord:8},
      {h:'lifewithgingy',ggmv:58293,flw:9121,v30:30,gmvN:2172,gmvT:19697,views:98294,avgv:3276,ord:153},
      {h:'markandgemma',ggmv:12305,flw:108994,v30:30,gmvN:1753,gmvT:12818,views:108594,avgv:3620,ord:77},
      {h:'macktheblacklab',ggmv:0,flw:3421,v30:28,gmvN:170,gmvT:170,views:20260,avgv:724,ord:1},
      {h:'reliable.rosalie',ggmv:14619,flw:10753,v30:23,gmvN:894,gmvT:894,views:19219,avgv:836,ord:6},
      {h:'michellepearlpnw',ggmv:36680,flw:18504,v30:18,gmvN:1984,gmvT:11636,views:131586,avgv:7310,ord:73},
      {h:'one_true_eric',ggmv:0,flw:109011,v30:17,gmvN:190,gmvT:490,views:16429,avgv:966,ord:3},
      {h:'sherri_york',ggmv:0,flw:4992,v30:16,gmvN:0,gmvT:0,views:7342,avgv:459,ord:0},
      {h:'measuredmacros',ggmv:135291,flw:11467,v30:15,gmvN:135,gmvT:3424,views:39714,avgv:2648,ord:21},
      {h:'moonstonefool',ggmv:0,flw:10301,v30:10,gmvN:780,gmvT:780,views:11854,avgv:1185,ord:5},
      {h:'baaego',ggmv:0,flw:6334,v30:9,gmvN:150,gmvT:150,views:8954,avgv:995,ord:1},
      {h:'amandacountryishmama',ggmv:0,flw:5661,v30:8,gmvN:138,gmvT:138,views:4612,avgv:577,ord:1},
      {h:'morgan_ttsfinds',ggmv:0,flw:6519,v30:8,gmvN:0,gmvT:285,views:6563,avgv:820,ord:2},
      {h:'michellepesco',ggmv:0,flw:12743,v30:7,gmvN:155,gmvT:155,views:6737,avgv:962,ord:1}
    ]
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
      tables: REPORT_DATA.tables
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
