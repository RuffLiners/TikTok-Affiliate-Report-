// Daily: record the usage-rights creator count so the scorecard can show history later.
import { Euka } from './euka.js'
import { pullUsageRightsNow } from './pull.js'
import { saveSnapshot } from './publish.js'
import { laToday } from './dates.js'
import { slack } from './slack.js'

async function main() {
  const day = laToday()
  const e = await Euka.connect()
  try {
    const n = await pullUsageRightsNow(e, `snapshot-${day}`)
    await saveSnapshot(day, { usageRightsCreators: n })
    console.log(`snapshot ${day}: usageRightsCreators=${n}`)
  } finally { await e.close().catch(() => {}) }
}
main().catch(async (err: Error) => {
  console.error(err)
  await slack(`:rotating_light: *Scorecard daily snapshot FAILED*: ${String(err.message).slice(0, 400)}. Usage-rights history will have a gap. Email sent to brandon@ruffliners.com.`)
  process.exit(1)
})
