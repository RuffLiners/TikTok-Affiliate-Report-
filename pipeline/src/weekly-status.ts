// Runs in the workflow with `if: always()`: turns the progress file into the status email outputs. A run that was
// cancelled or timed out never finished, so it is reported FAILED with failedStep "unknown (run cancelled or timed out)".
import { existsSync, readFileSync } from 'node:fs'
import { finalStatus, progressPath, writeOutputs, Progress } from './weekly/status.js'

const p: Progress | null = existsSync(progressPath()) ? JSON.parse(readFileSync(progressPath(), 'utf8')) : null
const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined
writeOutputs(finalStatus(p, { reportDate: (process.env.REPORT_DATE || '').trim() || undefined, dashboardUrl: process.env.DASHBOARD_URL, runUrl }))
