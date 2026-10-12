import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.env.PIPELINE_CACHE_DIR || join(process.cwd(), '.cache')

/** Cache a step's raw result by report date + step so a failed run resumes. */
export async function cached<T>(reportDate: string, step: string, fn: () => Promise<T>): Promise<T> {
  const dir = join(ROOT, reportDate)
  const file = join(dir, `${step}.json`)
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as T
  const out = await fn()
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify(out))
  return out
}
