// Drives a chunked report job (report_jobs) to completion from the browser.
// POST /api/jobs/run kicks a phase and returns immediately — the phase itself
// executes detached on the server (it can run 5-12 minutes, far longer than
// browsers keep a request open). We poll the job row until the phase ends,
// then kick the next one, until the job is done or errors.

export class JobFailedError extends Error {}

interface JobRow {
  status: string
  phase: number
  phase_label: string | null
  error: string | null
  updated_at: string
}

const PHASE_ENDED = /done|unavailable|complete|✓/i
// Server marks transient phase failures (timeouts, overloaded API) with this
// label — the next kick re-runs the phase immediately
const PHASE_RETRY = /retrying/i
const POLL_MS = 5000
// If the job row hasn't moved for this long, the phase runner died (deploy,
// crash, platform timeout) — kick again; the server re-runs the unfinished
// phase. Must exceed the server's in-flight guard window (10 min).
const STALE_MS = 12 * 60 * 1000
const MAX_POLL_MISSES = 24

async function fetchJob(jobId: string): Promise<JobRow | null> {
  try {
    const res = await fetch(`/api/jobs/${jobId}`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function driveJob(jobId: string): Promise<void> {
  while (true) {
    try {
      const res = await fetch('/api/jobs/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const job = await fetchJob(jobId)
        throw new JobFailedError(String(job?.error ?? data?.error ?? `Phase failed (HTTP ${res.status})`))
      }
      if (data.done) return
    } catch (e) {
      if (e instanceof JobFailedError) throw e
      // Transient network error on the kick — the poll loop below recovers:
      // its stale check re-kicks if the phase never actually started.
    }

    let misses = 0
    while (true) {
      await new Promise(r => setTimeout(r, POLL_MS))
      const job = await fetchJob(jobId)
      if (!job) {
        if (++misses >= MAX_POLL_MISSES) {
          throw new JobFailedError('Network error — check your connection and try again.')
        }
        continue
      }
      misses = 0
      if (job.status === 'done') return
      if (job.status === 'error') throw new JobFailedError(job.error || 'Job failed')
      const phaseEnded = PHASE_ENDED.test(job.phase_label || '')
      const needsRetry = PHASE_RETRY.test(job.phase_label || '')
      const stale = Date.now() - new Date(job.updated_at).getTime() > STALE_MS
      if (phaseEnded || needsRetry || stale) break
    }
  }
}
