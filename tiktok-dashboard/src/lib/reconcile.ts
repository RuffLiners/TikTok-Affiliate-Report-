// Cross-checks a report's tier breakdowns against its headline totals.
// Catches extraction drift (e.g. a level breakdown from a different query run
// than the totals) so no report saves with silently inconsistent numbers.
export function reconcileD30(d30: any): string[] {
  const warnings: string[] = []
  const LVLS = ['l1','l2','l3','l4','l5','l6','l7']
  const sum = (f: string) => LVLS.reduce((a, k) => a + (Number(d30?.tiers?.[k]?.[f]) || 0), 0)
  const check = (name: string, total: number, s: number, tolPct: number) => {
    if (!total || !s) return
    const diff = Math.abs(total - s) / total * 100
    if (diff > tolPct) warnings.push(`${name}: levels sum to ${Math.round(s).toLocaleString('en-US')} but total is ${Math.round(total).toLocaleString('en-US')} (${diff.toFixed(1)}% apart)`)
  }
  check('GMV', d30?.gmv, sum('gmv'), 3)
  check('Views', d30?.views, sum('views'), 5)
  check('Messages', d30?.msgs, sum('msgs'), 5)
  check('Samples', d30?.samples, sum('samples'), 10)
  const spendSum = (d30?.gmvMaxByAge || []).reduce((a: number, b: any) => a + (Number(b?.spend) || 0), 0)
  if (d30?.gmvMax?.spend && spendSum) {
    const diff = Math.abs(d30.gmvMax.spend - spendSum) / d30.gmvMax.spend * 100
    if (diff > 3) warnings.push(`GMV Max spend: age buckets sum to ${Math.round(spendSum).toLocaleString('en-US')} but total is ${Math.round(d30.gmvMax.spend).toLocaleString('en-US')} (${diff.toFixed(1)}% apart)`)
  }
  return warnings
}
