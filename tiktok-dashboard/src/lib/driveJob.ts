// Drives a chunked report job (report_jobs) to completion from the browser.
// POST /api/jobs/run claims one ready phase and returns immediately — the
// phase executes detached on the server (5-12 minutes, far longer than
// browsers keep a request open). Data phases are independent, so we keep
// several running concurrently and poll the job row for progress.

export class JobFailedError extends Error {}

interface JobRow {
  status: string
  phase: number
  phase_label: string | null
  error: string | null
  updated_at: string
  phases?: { total: number; done: number; running: number }
}

// How many phases to keep in flight. Each is a separate Claude+Euka call, so
// this bounds concurrent load on both APIs while cutting wall time ~3x.
const CONCURRENCY = 3
const POLL_MS = 5000
// The job runs server-side; the browser only polls and kicks phases. Ride out
// long connectivity blips (sleep, Wi-Fi drops) instead of giving up — phases
// in flight keep executing the whole time.
const MAX_POLL_MISSES = 120 // 10 minutes

async function fetchJob(jobId: string): Promise<JobRow | 'auth' | null> {
  try {
    const res = await fetch(`/api/jobs/${jobId}`)
    if (res.status === 401) return 'auth'
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function driveJob(jobId: string): Promise<void> {
  let misses = 0
  while (true) {
    const job = await fetchJob(jobId)
    if (job === 'auth') {
      throw new JobFailedError('Session expired — log in again, then hit Try again to resume the run.')
    }
    if (!job) {
      if (++misses >= MAX_POLL_MISSES) {
        throw new JobFailedError('Lost contact with the server — the report may still be generating. Try again to reconnect and resume.')
      }
      await new Promise(r => setTimeout(r, POLL_MS))
      continue
    }
    misses = 0
    if (job.status === 'done') return
    if (job.status === 'error') throw new JobFailedError(job.error || 'Job failed')

    // Top up to CONCURRENCY running phases; the server picks which phase each
    // kick claims (or reports nothing ready / job finished)
    const running = job.phases?.running ?? 0
    for (let slot = running; slot < CONCURRENCY; slot++) {
      let data: any
      try {
        const res = await fetch('/api/jobs/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId })
        })
        data = await res.json().catch(() => ({}))
        if (!res.ok) {
          const fresh = await fetchJob(jobId)
          const freshErr = fresh && fresh !== 'auth' ? fresh.error : null
          throw new JobFailedError(String(freshErr ?? data?.error ?? `Phase failed (HTTP ${res.status})`))
        }
      } catch (e) {
        if (e instanceof JobFailedError) throw e
        break // transient network error on the kick — next poll retries
      }
      if (data.done) return
      if (!data.started) break // nothing ready right now
    }

    await new Promise(r => setTimeout(r, POLL_MS))
  }
}
