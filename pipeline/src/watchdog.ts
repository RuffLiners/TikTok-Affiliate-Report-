// Daily drift check. Catches the "never ran" case (the missing Nov 2 report) as well as a run that published nothing.
import { readState } from './publish.js'
import { laToday } from './dates.js'
import { alert } from './notify.js'
import { addDays } from '../../tiktok-dashboard/src/lib/scorecard/index'

async function main() {
  const today = laToday()
  const { latest } = await readState()
  const maxAgeDays = 8
  if (!latest) throw new Error('No scorecard has ever been published.')
  if (latest.as_of < addDays(today, -maxAgeDays)) {
    await alert('DRIFT', `The newest published scorecard is for ${latest.as_of}, more than ${maxAgeDays} days before today (${today}). The Monday run did not publish.`)
    process.exit(1)
  }
  console.log(`ok: latest scorecard ${latest.as_of}`)
}
main().catch(async (err: Error) => { console.error(err); await alert('STUCK', `Watchdog could not verify the latest scorecard: ${String(err.message).slice(0, 400)}`); process.exit(1) })
