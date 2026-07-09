// Drives a chunked report job (report_jobs) to completion from the browser.
// Each phase is one POST /api/jobs/run call that can run for several minutes
// server-side — longer than browsers keep a request open (Chrome ~300s,
// Safari ~60s). When the browser kills the request, the Vercel function keeps
// running, so instead of failing we poll the job row until the phase lands,
// then kick the next one.

export class JobFailedError extends Error {}

interface JobRow {
  status: string
  phase: number
  phase_label: string | null
  error: string | null
  updated_at: string
}

const PHASE_ENDED = /done|unavailable|complete|✓/i
const POLL_MS = 5000
// If the job row hasn't moved for this long, the runner function died
// (deploy, crash, platform timeout) — safe to kick the same phase again.
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
      if (data.nextPhase == null) return
      continue
    } catch (e) {
      if (e instanceof JobFailedError) throw e
      // Request was killed by the browser or a transient network error —
      // the server phase is likely still running. Fall through to polling.
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
      const stale = Date.now() - new Date(job.updated_at).getTime() > STALE_MS
      if (phaseEnded || stale) break
    }
  }
}
