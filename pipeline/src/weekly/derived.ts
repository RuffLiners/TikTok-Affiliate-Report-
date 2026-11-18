// SKILL.md Phase 4 "checks worth running for the analysis", computed in code from the same exports the build used,
// so the analysis can quote them and the audit can trace them (controls.derived_numbers).
import { parseCsv } from './csv.js'
import { addDays, laDate } from './windows.js'

const r2 = (x: number) => Math.round(x * 100) / 100
const r1 = (x: number) => Math.round(x * 10) / 10
const num = (s: string | undefined) => { const n = Number(s || 0); return Number.isFinite(n) ? n : 0 }

/** Same product short names as build_report.py short(). */
export function shortProduct(p: string): string {
  p = p || ''
  if (p.includes('XL Floor Cover')) return 'XL Floor Cover'
  if (p.includes('Travel Bed') || p.includes('Travel Dog Bed')) return 'Travel Dog Bed'
  if (p.includes('Hard Bottom Backseat Extenders') || p.includes('Back Seat Extender')) return 'Back Seat Ext.'
  if (p.includes('Hammock')) return 'Soft Hammock'
  if (p.includes('Seat Cover')) return 'Seat Cover'
  return p.slice(0, 40) || 'Unknown'
}

export function deriveFacts(lifetimeCsv: string, cw30Csv: string, windowStart: string, windowEnd: string) {
  const life = parseCsv(lifetimeCsv).filter(r => r['Date'])
  const cw = parseCsv(cw30Csv)
  const posted = new Map<string, string>()
  const first = new Map<string, string>(), last = new Map<string, string>(), ggmv = new Map<string, number>(), lifeGmv = new Map<string, number>()
  for (const r of life) {
    const d = laDate(r['Date']), h = r['Creator'].trim().toLowerCase()
    posted.set(r['Video ID'], d)
    if (!first.has(h) || d < first.get(h)!) first.set(h, d)
    if (!last.has(h) || d > last.get(h)!) { last.set(h, d); ggmv.set(h, num(r['Creator 30-Day GMV'])) }
    lifeGmv.set(h, (lifeGmv.get(h) ?? 0) + num(r['Video Revenue']))
  }
  const total = cw.reduce((t, r) => t + num(r['Video Revenue']), 0)
  let older = 0, unknownPost = 0
  const byCreator = new Map<string, number>(), byProduct = new Map<string, number>()
  for (const r of cw) {
    const g = num(r['Video Revenue']), d = posted.get(r['Video ID']), h = r['Creator'].trim().toLowerCase()
    if (!d) unknownPost += g; else if (d < windowStart) older += g
    byCreator.set(h, (byCreator.get(h) ?? 0) + g)
    const p = shortProduct(r['Product'])
    byProduct.set(p, (byProduct.get(p) ?? 0) + g)
  }
  const ranked = [...byCreator.entries()].sort((a, b) => b[1] - a[1])
  const top3 = ranked.slice(0, 3).reduce((t, x) => t + x[1], 0)
  const share = (x: number) => (total ? r1((x / total) * 100) : null)
  const newSince = addDays(windowEnd, -20) // first post in the last 3 weeks of the window
  const inactiveBefore = addDays(windowEnd, -30)
  const inactive = [...last.entries()].filter(([, d]) => d < inactiveBefore).map(([h, d]) => ({ h, lastPost: d, globalGmv30d: r2(ggmv.get(h) ?? 0), lifetimeStoreGmv: r2(lifeGmv.get(h) ?? 0) }))
  return {
    window: { start: windowStart, end: windowEnd, creatorVideoGmvFromCommerceExport: r2(total) },
    olderVideos: { gmvFromVideosPostedBeforeWindow: r2(older), sharePct: share(older), gmvWithUnknownPostDate: r2(unknownPost) },
    concentration: {
      topCreator: ranked[0] ? { h: ranked[0][0], gmv: r2(ranked[0][1]), sharePct: share(ranked[0][1]) } : null,
      top3: { handles: ranked.slice(0, 3).map(x => x[0]), gmv: r2(top3), sharePct: share(top3) },
    },
    gmvByProduct: [...byProduct.entries()].sort((a, b) => b[1] - a[1]).map(([product, gmv]) => ({ product, gmv: r2(gmv), sharePct: share(gmv) })),
    newCreatorsLast3Weeks: [...first.entries()].filter(([, d]) => d >= newSince && d <= windowEnd)
      .map(([h, d]) => ({ h, firstPost: d, windowGmv: r2(byCreator.get(h) ?? 0) })).sort((a, b) => b.windowGmv - a.windowGmv).slice(0, 10),
    inactiveByGlobalGmv: [...inactive].sort((a, b) => b.globalGmv30d - a.globalGmv30d).slice(0, 10),
    inactiveByLifetimeStoreGmv: [...inactive].sort((a, b) => b.lifetimeStoreGmv - a.lifetimeStoreGmv).slice(0, 10),
  }
}
