// Step 1 auth proof: a plain MCP client must call BOTH a brand-scoped tool
// (list_accessible_brands) and a store-scoped tool (get_gmv_max_creative_report).
// Any failure is posted to Slack; auth failures use the "token expired" message.
import { Euka, STORE_ID } from './euka.js'
import { slack } from './slack.js'

const AUTH_RE = /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid[_ ]token|expired/i

function iso(d: Date) { return d.toISOString().slice(0, 10) }

async function main() {
  const e = await Euka.connect()
  try {
    const out = await e.call('list_accessible_brands', {})
    const brands: any[] = Array.isArray(out) ? out : (out?.brands ?? out?.items ?? [])
    console.log(`OK list_accessible_brands: ${brands.length} brand(s)`)
    for (const b of brands) {
      const stores = (b.stores ?? []).map((s: any) => s.storeId ?? s.id).join(', ')
      console.log(`- ${b.name ?? b.brandName ?? '?'} (${b.brandId ?? b.id ?? '?'}) stores: ${stores}`)
    }
    if (!brands.length) throw new Error('list_accessible_brands returned no brands: ' + JSON.stringify(out).slice(0, 300))

    const end = new Date(Date.now() - 2 * 86400000)
    const start = new Date(end.getTime() - 29 * 86400000)
    const page = await e.call('get_gmv_max_creative_report', {
      storeId: STORE_ID, startDate: iso(start), endDate: iso(end), pageSize: 1, page: 1,
    })
    console.log(`OK get_gmv_max_creative_report p1: keys=${Object.keys(page ?? {}).join(',')} hasMore=${page?.hasMore} rows=${page?.rows?.length}`)
    console.log(JSON.stringify(page).slice(0, 600))
  } finally {
    await e.close().catch(() => {})
  }
}

main().catch(async (err: Error) => {
  const msg = String(err?.message ?? err)
  console.error('PROBE FAILED:', msg)
  await slack(AUTH_RE.test(msg)
    ? ':rotating_light: Euka token expired — refresh EUKA_BEARER_TOKEN (weekly report not started)'
    : `:rotating_light: Euka probe failed: ${msg.slice(0, 500)}`)
  process.exit(1)
})
