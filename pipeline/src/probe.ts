// Auth proof: a plain MCP client calls list_accessible_brands with EUKA_BEARER_TOKEN.
import { Euka } from './euka.js'

const e = await Euka.connect()
const out = await e.call('list_accessible_brands', {})
const brands: any[] = Array.isArray(out) ? out : (out?.brands ?? out?.items ?? [])
console.log(`OK: list_accessible_brands returned ${brands.length || '(non-array)'} brand(s)`)
for (const b of brands) console.log(`- ${b.name ?? b.brandName ?? '?'} (${b.id ?? b.brandId ?? '?'})`)
if (!brands.length) console.log(JSON.stringify(out).slice(0, 500))
await e.close()
