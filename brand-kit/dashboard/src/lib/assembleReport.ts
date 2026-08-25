// Window derivation + report assembly for the weekly report. Extracted from
// the jobs/run route so the exact production code is importable outside the
// route handler — scripts/parity-diff.ts runs it against a manual skill run
// to prove auto/manual parity, and golden-diff can re-assemble frozen data.
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { sanitizeRows, sanitizeTables } from '@/lib/sanitize'
import { PROMPT_VERSION } from '@/lib/canonicalDefs'

// Every report date — window boundaries, Sun–Sat weeks, months — is defined in
// America/Los_Angeles. Vercel runs in UTC, so deriving "today" from the raw
// clock shifts every boundary one day forward for evening runs; shift to LA
// first. An explicit params.today (YYYY-MM-DD) is already a calendar date.
export const REPORT_TZ = 'America/Los_Angeles'
export function todayInReportTz(param?: string): Date {
  if (param) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(param)
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return new Date(param)
  }
  return new Date(new Date().toLocaleString('en-US', { timeZone: REPORT_TZ }))
}

export function buildWindows(today: Date) {
  const gmvEnd = subDays(today, 2), gmvStart = subDays(gmvEnd, 29)
  const priorEnd = subDays(gmvStart, 1), priorStart = subDays(priorEnd, 29)
  const dow = gmvEnd.getDay()
  const lastSat = dow === 6 ? gmvEnd : subDays(gmvEnd, dow + 1)
  const last7Start = subDays(lastSat, 6)
  const weeks = Array.from({ length: 13 }, (_, i) => {
    const wEnd = subDays(lastSat, i * 7); return { start: subDays(wEnd, 6), end: wEnd }
  }).reverse()
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(today, 5 - i); const ip = i === 5
    // current partial month: use today as end so MTD covers the full date range available
    return { key: format(d, 'yyyy-MM'), label: format(d, 'MMM') + (ip ? '*' : ''), start: startOfMonth(d), end: ip ? today : endOfMonth(d) }
  })
  const f = (d: Date) => format(d, 'yyyy-MM-dd')
  return {
    reportDate: format(today, 'yyyy-MM-dd'), label: format(today, 'MMMM d, yyyy'),
    dataWindow: `${format(gmvStart, 'MMM d')} – ${format(gmvEnd, 'MMM d, yyyy')}`,
    d30: { start: f(gmvStart), end: f(gmvEnd) }, prior: { start: f(priorStart), end: f(priorEnd) },
    last7: { start: f(last7Start), end: f(lastSat) }, weeks, months,
    currentMonthStart: f(startOfMonth(today)), currentMonthEnd: f(today),
    weekLabels: weeks.map(w => `${w.start.getMonth()+1}/${w.start.getDate()}`),
    monthLabels: months.map(m => m.label),
    weeksRange: `${f(weeks[0].start)} to ${f(lastSat)}`,
    monthKeys: months.map(m => m.key).join(', ')
  }
}

export function assemble(w: ReturnType<typeof buildWindows>, pd: any, analysis: any) {
  const a1=pd.A1||{}, a2=pd.A2||{}, a3=pd.A3||{}, a4=pd.A4||{total:{}}, a5=pd.A5||{total:{}}, a6=pd.A6||{}
  // % change vs prior — 1 decimal everywhere, and null (not 0) when the prior
  // value is 0: the UI renders null as no-change instead of a fake 0%
  const pct=(c:number,p:number)=>p?Math.round(((c-p)/p)*1000)/10:null
  const round1=(v:any)=>{const n=Number(v);return Number.isFinite(n)?Math.round(n*10)/10:undefined}
  const delta=(c:number,p:number)=>Math.round((c-p)*10)/10
  // retention must be a percent (28.0); a model that answers with a
  // fraction (0.28) gets normalized rather than displayed as 0.28%
  const asPct=(v:any)=>{const n=Number(v)||0;return n>0&&n<=1?Math.round(n*1000)/10:n}
  // Retention SERIES arrive in whatever shape the extraction model picked —
  // plain numbers or {retention: x} objects — and sometimes on the fraction
  // scale (0.38 instead of 38). Normalize at the payload boundary: unwrap
  // objects, and if every nonzero value is < 1 the whole array is fractions,
  // so multiply by 100 once. This is what kept weekly ret at all-zeros and
  // the monthly retention chart empty against a 0-4% axis.
  const retVal=(r:any)=>{if(r&&typeof r==='object'){const v=Number(r.retention??r.ret??r.rate??r.value);return Number.isFinite(v)?v:0}const v=Number(r);return Number.isFinite(v)?v:0}
  const normRet=(rows:any[])=>{const vals=(rows||[]).map(retVal);const nz=vals.filter(v=>v>0);const frac=nz.length>0&&nz.every(v=>v<1);return vals.map(v=>Math.round((frac?v*100:v)*10)/10)}
  const LVLS=['l1','l2','l3','l4','l5','l6','l7'] as const
  const c1=pd.C1||[], c3=pd.C3||[], c4=pd.C4||[], c5=pd.C5||{}
  const d1=pd.D1||[], d3=pd.D3||[], d4=pd.D4||{}
  // by-tier series arrive as two halves (posting counts / GMV+views);
  // legacy single-phase C2/D2 payloads still resolve
  const c2p=pd.C2P||pd.C2||{}, c2v=pd.C2V||pd.C2||{}
  const d2p=pd.D2P||pd.D2||{}, d2v=pd.D2V||pd.D2||{}
  const mkTier=(lk:string)=>({
    creators:a3[lk]?.creators||0,newCreators:a3[lk]?.newCreators||0,videos:a3[lk]?.videos||0,views:a3[lk]?.views||0,gmv:a3[lk]?.gmv||0,
    // 0, not undefined: the skill emits explicit zeros and auto/manual rows
    // must be identical (the UI treats 0 and missing the same)
    gmvMaxSpend:a6[lk]?.spend||0,gmvMaxRoi:a6[lk]?.roi||0,
    msgs:a4[lk]?.msgs||0,msgsPct:pct(a4[lk]?.msgs||0,a5[lk]?.msgs||0),
    samples:a4[lk]?.samples||0,samplesPct:pct(a4[lk]?.samples||0,a5[lk]?.samples||0)
  })
  return {
    report_date:w.reportDate, label:w.label, data_window:w.dataWindow,
    d30:{
      // Provenance stamp: which spec produced this report and the exact
      // windows the server injected, echoed back so drift between the skill,
      // the manual prompt, and this pipeline is verifiable from the output
      meta:{
        promptVersion:PROMPT_VERSION,
        weekWindow:{start:w.last7.start,end:w.last7.end},
        d30Window:{start:w.d30.start,end:w.d30.end},
        priorWindow:{start:w.prior.start,end:w.prior.end},
        timezone:REPORT_TZ,
        generatedAt:new Date().toISOString()
      },
      gmv:a1.gmv||0, gmvPct:pct(a1.gmv||0,a2.gmv||0),
      shopGmv:a1.shopGmv||undefined, shopGmvPct:a1.shopGmv?round1(a1.shopGmvPct):undefined,
      affiliateGmv:a1.affiliateGmv||undefined, affiliateGmvPct:a1.affiliateGmv?round1(a1.affiliateGmvPct):undefined,
      orders:a1.orders||0, ordersPct:pct(a1.orders||0,a2.orders||0),
      videos:a1.videos||0, videosPct:pct(a1.videos||0,a2.videos||0), views:a1.views||0, viewsPct:pct(a1.views||0,a2.views||0),
      creators:a1.creators||0, creatorsPct:pct(a1.creators||0,a2.creators||0), newCreators:a1.newCreators||0, newCreatorsPct:pct(a1.newCreators||0,a2.newCreators||0),
      retention:asPct(a1.retention), retentionDelta:delta(asPct(a1.retention),asPct(a2.retention)),
      gmvMax:{spend:a6.spend||0,revenue:a6.revenue||0,roi:a6.roi||0},
      gmvMaxByAge:(pd.A7&&pd.A7.length>0)?sanitizeRows(pd.A7):undefined,
      msgs:a4.total?.msgs||0, msgsPct:pct(a4.total?.msgs||0,a5.total?.msgs||0),
      samples:a4.total?.samples||0, samplesPct:pct(a4.total?.samples||0,a5.total?.samples||0),
      tiers:Object.fromEntries(LVLS.map(lk=>[lk,mkTier(lk)])) as any
    },
    weekly_charts:{
      labels:w.weekLabels, gmv:c1.map((r:any)=>r.gmv||0), views:c4.map((r:any)=>r.views||0),
      ...Object.fromEntries(LVLS.map(lk=>[`crl${lk[1]}`,c2p[lk]?.map((r:any)=>r.creators||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`ncl${lk[1]}`,c2p[lk]?.map((r:any)=>r.newCreators||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`vl${lk[1]}`,c2p[lk]?.map((r:any)=>r.videos||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`gl${lk[1]}`,c2v[lk]?.map((r:any)=>r.gmv||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`vwl${lk[1]}`,c2v[lk]?.map((r:any)=>r.views||0)||[]])),
      ret:normRet(c3), vid:c4.map((r:any)=>r.videos||0),
      ...Object.fromEntries(LVLS.map(lk=>[`ml${lk[1]}`,c5[lk]?.map((r:any)=>r.msgs||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`sl${lk[1]}`,c5[lk]?.map((r:any)=>r.samples||0)||[]]))
    },
    monthly_charts:{
      labels:w.monthLabels, gmv:d1.map((r:any)=>r.gmv||0),
      // contract keys: shopGmv (total account GMV) + affiliateGmv, always
      // present. The legacy totalGmv alias is no longer written (the skill
      // never emitted it, and auto/manual rows must be identical); the report
      // page still reads it from old rows.
      shopGmv:d1.map((r:any)=>r.shopGmv||0),
      affiliateGmv:d1.map((r:any)=>r.gmv||0),
      views:d1.map((r:any)=>r.views||0),
      ...Object.fromEntries(LVLS.map(lk=>[`crl${lk[1]}`,d2p[lk]?.map((r:any)=>r.creators||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`ncl${lk[1]}`,d2p[lk]?.map((r:any)=>r.newCreators||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`vl${lk[1]}`,d2p[lk]?.map((r:any)=>r.videos||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`gl${lk[1]}`,d2v[lk]?.map((r:any)=>r.gmv||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`vwl${lk[1]}`,d2v[lk]?.map((r:any)=>r.views||0)||[]])),
      ret:normRet(d3),
      ...Object.fromEntries(LVLS.map(lk=>[`ml${lk[1]}`,d4[lk]?.map((r:any)=>r.msgs||0)||[]])),
      ...Object.fromEntries(LVLS.map(lk=>[`sl${lk[1]}`,d4[lk]?.map((r:any)=>r.samples||0)||[]])),
      // samples APPROVED by level per month (request-created date basis);
      // contract requires the keys even when every value is 0
      ...Object.fromEntries(LVLS.map(lk=>[`sal${lk[1]}`,d4[lk]?.map((r:any)=>r.approved||0)||Array(w.monthLabels.length).fill(0)]))
    },
    tables:sanitizeTables({
      topCreators:pd.topCreators||[], topVideos:pd.topVideos||[], activeCreators:pd.activeCreators||[],
      weeklyTopCreators:pd.weeklyTopCreators||[], weeklyTopVideos:pd.weeklyTopVideos||[], weeklyActiveCreators:pd.weeklyActiveCreators||[]
    }),
    agents:pd.agents||[],
    analysis: analysis?.performance !== undefined
      ? analysis
      : { d30:analysis?.d30||'', weekly:analysis?.weekly||'', monthly:analysis?.monthly||'' }
  }
}
