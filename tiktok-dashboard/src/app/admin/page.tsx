'use client'
import { useState, useEffect, useRef } from 'react'
import { format, subDays } from 'date-fns'
import { ManageTab } from './ManageTab'

function getReportMonday(from: Date = new Date()): Date {
  const day = from.getDay() // 0=Sun,1=Mon,...,6=Sat
  const d = new Date(from)
  d.setHours(0, 0, 0, 0)
  if (day === 0) {
    // Sunday: last complete Sun-Sat week ended yesterday; report Monday = tomorrow
    d.setDate(d.getDate() + 1)
  } else {
    // Mon: today; Tue-Sat: back to last Monday
    d.setDate(d.getDate() - (day - 1))
  }
  return d
}

function weekLabel(monday: Date): string {
  const sat = subDays(monday, 2)   // Saturday of the reported week
  const sun = subDays(monday, 8)   // Sunday of the reported week
  const sameMo = sun.getMonth() === sat.getMonth()
  return sameMo
    ? `${format(sun, 'MMM d')}–${format(sat, 'd')}`
    : `${format(sun, 'MMM d')}–${format(sat, 'MMM d')}`
}

function getRecentMondays(n: number): Date[] {
  const last = getReportMonday()
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(last)
    d.setDate(d.getDate() - i * 7)
    return d
  })
}

type SaveStatus   = 'idle' | 'saving' | 'success' | 'error'
type GenStatus    = 'idle' | 'running' | 'success' | 'error'
type KeySaveState = 'idle' | 'saving' | 'saved' | 'error'

interface ConfigStatus {
  ready: boolean
  anthropicKey: { set: boolean; source: string; masked: string | null }
  eukaMcpUrl: { set: boolean }
  eukaStoreId: { set: boolean }
}

const STORE_ID = '455ea4f9-a404-411b-b748-9ba1929efb93'

function buildClaudePrompt(today: Date, goals?: any): string {
  const gmvEnd   = subDays(today, 2)   // always a Saturday (today is Monday)
  const gmvStart = subDays(gmvEnd, 29)
  const priorEnd  = subDays(gmvStart, 1)
  const priorStart = subDays(priorEnd, 29)
  // last complete Sun–Sat week (gmvEnd is always the Saturday)
  const weekSat   = gmvEnd
  const weekSun   = subDays(weekSat, 6)
  const f = (d: Date) => format(d, 'yyyy-MM-dd')
  const fLabel = (d: Date) => format(d, 'MMM d')

  let goalsSection = ''
  if (goals && (goals.monthlyGmvTarget || goals.quarterlyGmvTarget || goals.weeklyVideosTarget || goals.activeG3Target)) {
    goalsSection = `\nGOALS & TARGETS — reference these when writing analysis:\n`
    if (goals.monthlyGmvTarget) {
      goalsSection += `- Monthly GMV goal: $${Math.round(goals.monthlyGmvTarget).toLocaleString('en-US')}${goals.monthlyPeriod ? ` (${goals.monthlyPeriod})` : ''}\n`
    }
    if (goals.quarterlyGmvTarget) {
      goalsSection += `- Quarterly GMV goal: $${Math.round(goals.quarterlyGmvTarget).toLocaleString('en-US')}${goals.quarterlyPeriod ? ` (${goals.quarterlyPeriod})` : ''}\n`
    }
    if (goals.weeklyVideosTarget) {
      goalsSection += `- Weekly videos target: ${goals.weeklyVideosTarget}/week\n`
    }
    if (goals.activeG3Target) {
      goalsSection += `- Active G3 creators target: ${goals.activeG3Target}\n`
    }
    goalsSection += '\n'
  }

  return `Run the Ruff Liners TikTok Shop weekly report for today ${format(today, 'MMMM d, yyyy')}.

Store ID: ${STORE_ID}

DATE WINDOWS — use these exactly:
- Current 30d: ${f(gmvStart)} to ${f(gmvEnd)}
- Prior 30d: ${f(priorStart)} to ${f(priorEnd)}
- Last complete week (most recent Sun–Sat): ${f(weekSun)} to ${f(weekSat)} — use this as "this week" in analysis
- 13 complete Sun–Sat weeks ending on ${f(weekSat)} (inclusive — the most recent complete week IS ${f(weekSun)}–${f(weekSat)})
- 6 months: the 5 complete calendar months before this one + current partial month through ${f(gmvEnd)}

QUERIES TO RUN (read every CSV file Euka returns):
1. Current 30d totals: GMV, orders, videos posted, views, creators posted, new creators (first-ever post for this store), retention rate vs prior period
2. Prior 30d: same totals for % change calculations
3. Current 30d by creator tier (G1 = global gmv_30d <$25K, G2 = $25K–$100K, G3 = >$100K): creators, new creators, videos posted, store GMV
4. Current 30d outreach by tier: messages sent + samples shipped, plus overall totals
5. Prior 30d outreach: totals + by tier (for % change)
6. GMV Max current 30d: total ad spend, attributed revenue, blended ROI (use 0 if data unavailable before May 14 2026)
7. Top 15 creators by store GMV — handle, followers, store GMV, global gmv_30d, views, videos L30d, videos w/GMV L30d, lifetime videos, videos L7d, orders, AOV, engagement rate
8. For the top 15 handles from #7: count of videos that generated any GMV this period, and lifetime total videos for this store
9. Top 15 videos by store GMV — creator handle, product name, GMV, views, orders, AOV, publish date, likes, comments, product clicks
10. Top 15 creators by videos posted — handle, followers, GMV from new-period videos only, total store GMV, views, avg views/video, orders
11. 13 weekly totals: GMV, orders, views, videos (13 rows, one per Sun–Sat week)
12. 13 weeks by tier: creators posted, new creators, videos, store GMV per week per tier (39 rows)
13. 13 weeks: retention rate per week (13 rows)
14. 13 weeks: messages sent + samples shipped by tier per week (39 rows)
15. 6 months: total GMV + views per month (6 rows)
16. 6 months by tier: creators, new creators, videos, GMV (18 rows)
17. 6 months: retention rate per month (6 rows)
18. 6 months: messages + samples by tier per month (18 rows)
19. This week's top 10 creators by store GMV (${f(weekSun)}–${f(weekSat)}): handle, global gmv_30d, store GMV this week, views this week, videos posted this week, orders, AOV
20. Top 10 videos by GMV posted this week (${f(weekSun)}–${f(weekSat)}): creator handle, global gmv_30d, product name, GMV, views, orders, AOV, likes, comments, product clicks, publish date
21. This week's top 10 most active creators by videos posted (${f(weekSun)}–${f(weekSat)}): handle, global gmv_30d, store GMV this week, views this week, videos posted, orders, AOV
${goalsSection}
ANALYSIS — write 4 focused sections after pulling all data:
- "performance": 3–4 paragraphs — This week's headline numbers (last complete Sun–Sat week), MTD progress vs monthly goal (state if on/off track and by how much), QTD progress vs quarterly goal, what's driving results. Be specific: name the creators/products/tiers moving the numbers.
- "creators": 2–3 paragraphs — New creator breakouts: any creator in their first 1–3 weeks already generating meaningful GMV (name them, their numbers, why they're exciting). Top performing content this week (specific video + creator + GMV). Which tier is most active and most productive per creator. G3 activation pace vs target.
- "recruiting": 2–3 paragraphs — Top reactivation targets: inactive creators with high global GMV who haven't posted recently (name them, their global GMV, last post timing). Current outreach mix analysis (G2 vs G3 balance, is it aligned with where GMV comes from?). Sample allocation recommendations. Concrete next-week recruiting actions.
- "growth": 2–3 paragraphs — 13-week GMV trend direction and momentum. Which tier/product/content format is the primary growth engine right now. 2–3 specific opportunities to pursue this week. 1–2 risks to monitor. 4-week forward outlook with upside and downside scenarios.

OUTPUT — respond with ONLY this JSON object, nothing before or after it:

{
  "meta": {
    "reportDate": "${format(today, 'yyyy-MM-dd')}",
    "label": "${format(today, 'MMMM d, yyyy')}",
    "dataWindow": "${fLabel(gmvStart)} – ${fLabel(gmvEnd)}, ${format(gmvEnd, 'yyyy')}"
  },
  "d30": {
    "gmv": 0, "gmvPct": 0, "orders": 0, "ordersPct": 0,
    "videos": 0, "videosPct": 0, "views": 0, "viewsPct": 0,
    "creators": 0, "creatorsPct": 0, "newCreators": 0, "newCreatorsPct": 0,
    "retention": 0, "retentionDelta": 0,
    "gmvMax": { "spend": 0, "revenue": 0, "roi": 0 },
    "msgs": 0, "msgsPct": 0, "samples": 0, "samplesPct": 0,
    "tiers": {
      "g1": { "creators":0,"newCreators":0,"videos":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "g2": { "creators":0,"newCreators":0,"videos":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 },
      "g3": { "creators":0,"newCreators":0,"videos":0,"gmv":0,"msgs":0,"msgsPct":0,"samples":0,"samplesPct":0 }
    }
  },
  "weeklyCharts": {
    "labels": ["fill","in","13","week","labels","as","M/D"],
    "gmv":[],"views":[],
    "crg1":[],"crg2":[],"crg3":[],
    "ncg1":[],"ncg2":[],"ncg3":[],
    "vg1":[],"vg2":[],"vg3":[],
    "gg1":[],"gg2":[],"gg3":[],
    "ret":[],"vid":[],
    "mg1":[],"mg2":[],"mg3":[],
    "sg1":[],"sg2":[],"sg3":[]
  },
  "monthlyCharts": {
    "labels": ["fill","in","6","month","labels","e.g. May*"],
    "gmv":[],"views":[],
    "crg1":[],"crg2":[],"crg3":[],
    "ncg1":[],"ncg2":[],"ncg3":[],
    "vg1":[],"vg2":[],"vg3":[],
    "gg1":[],"gg2":[],"gg3":[],
    "ret":[],
    "mg1":[],"mg2":[],"mg3":[],
    "sg1":[],"sg2":[],"sg3":[]
  },
  "tables": {
    "topCreators": [
      { "h":"handle","flw":0,"sgmv":0,"ggmv":0,"views":0,"v30":0,"vmgmv":0,"vlife":0,"v7":0,"ord":0,"aov":0,"eng":null,"active":true }
    ],
    "topVideos": [
      { "h":"handle","ggmv":0,"prod":"product name","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":"May 1" }
    ],
    "activeCreators": [
      { "h":"handle","ggmv":0,"flw":0,"v30":0,"gmvN":0,"gmvT":0,"views":0,"avgv":0,"ord":0 }
    ],
    "weeklyTopCreators": [
      { "h":"handle","ggmv":0,"gmv":0,"views":0,"vid":0,"ord":0,"aov":0 }
    ],
    "weeklyTopVideos": [
      { "h":"handle","ggmv":0,"prod":"product name","gmv":0,"views":0,"ord":0,"aov":0,"likes":0,"cmt":0,"clicks":null,"date":"${fLabel(weekSun)}" }
    ],
    "weeklyActiveCreators": [
      { "h":"handle","ggmv":0,"gmv":0,"views":0,"vid":0,"ord":0,"aov":0 }
    ]
  },
  "analysis": {
    "performance": "Write 3-4 paragraphs. Use \\n\\n between paragraphs.",
    "creators": "Write 2-3 paragraphs. Use \\n\\n between paragraphs.",
    "recruiting": "Write 2-3 paragraphs. Use \\n\\n between paragraphs.",
    "growth": "Write 2-3 paragraphs. Use \\n\\n between paragraphs."
  }
}

Product name shortening: "Hard Bottom Backseat Extenders for Dogs with Door Protection" → "Back Seat Ext." · "XL Floor Cover for Full-Size Crew Cab Trucks with Fold Up Seats" → "XL Floor Cover" · "Travel Dog Bed for Car" → "Travel Dog Bed"`
}

const GENERATE_STEPS = [
  { id: 'kpis',      label: 'Pulling current & prior KPIs' },
  { id: 'tiers',     label: 'Pulling creator tiers & GMV Max' },
  { id: 'outreach',  label: 'Pulling outreach data' },
  { id: 'creators',  label: 'Pulling top creators' },
  { id: 'videos',    label: 'Pulling top videos' },
  { id: 'weekly1',   label: 'Pulling 13-week trends' },
  { id: 'weekly2',   label: 'Pulling 13-week retention & outreach' },
  { id: 'monthly1',  label: 'Pulling 6-month data' },
  { id: 'monthly2',  label: 'Pulling 6-month trends' },
  { id: 'analysis',  label: 'Writing analysis' },
  { id: 'saving',    label: 'Saving to dashboard' },
]

export default function AdminPage() {
  const [tab, setTab]           = useState<'paste' | 'auto' | 'manage'>('paste')
  const [selectedDate, setSelectedDate] = useState<Date>(() => getReportMonday())
  const mondays = getRecentMondays(5)
  const [json, setJson]         = useState('')
  const [saveStatus, setSave]   = useState<SaveStatus>('idle')
  const [saveError, setSaveErr] = useState('')
  const [saveResult, setSaveRes] = useState<{ label: string; gmv: number; reportDate: string } | null>(null)
  const [copied, setCopied]     = useState(false)

  const [genStatus, setGen]     = useState<GenStatus>('idle')
  const [genError, setGenErr]   = useState('')
  const [genResult, setGenRes]  = useState<{ label: string; gmv: number; reportDate: string } | null>(null)
  const [genStep, setGenStep]   = useState(0)
  const [phaseLabel, setPhaseLabel] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [goals, setGoals]       = useState<any>(null)
  const [config, setConfig]     = useState<ConfigStatus | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showApiKey, setShowApiKey]   = useState(false)
  const [keySaveState, setKeySave]    = useState<KeySaveState>('idle')
  const [keySaveErr, setKeySaveErr]   = useState('')

  // Read tab from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('tab')
    if (t === 'manage' || t === 'auto' || t === 'paste') setTab(t)
  }, [])

  // Fetch goals on mount
  useEffect(() => {
    fetch('/api/admin/goals').then(r => r.json()).then(d => { if (!d.error) setGoals(d) })
  }, [])

  // Fetch config status on mount
  useEffect(() => {
    fetch('/api/admin/check-config').then(r => r.json()).then(d => { if (!d.error) setConfig(d) })
  }, [])

  const today = new Date()
  const prompt = buildClaudePrompt(selectedDate, goals)
  const gmvEnd = subDays(selectedDate, 2)
  const gmvStart = subDays(gmvEnd, 29)
  const dataWindow = `${format(gmvStart, 'MMM d')} – ${format(gmvEnd, 'MMM d, yyyy')}`
  const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function saveReport() {
    setSave('saving')
    setSaveErr('')
    setSaveRes(null)

    let parsed: any
    try {
      parsed = JSON.parse(json.trim())
    } catch {
      setSave('error')
      setSaveErr('Invalid JSON — check for missing commas or brackets.')
      return
    }

    const res = await fetch('/api/save-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    })

    const data = await res.json().catch(() => ({ error: 'Unknown error' }))

    if (!res.ok) {
      setSave('error')
      setSaveErr(data.error || 'Save failed.')
    } else {
      setSave('success')
      setSaveRes({ label: data.label, gmv: data.gmv, reportDate: data.reportDate })
    }
  }

  async function saveApiKey() {
    setKeySave('saving')
    setKeySaveErr('')
    const res = await fetch('/api/admin/claude-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: apiKeyInput.trim() })
    })
    const data = await res.json().catch(() => ({ error: 'Unknown error' }))
    if (!res.ok) {
      setKeySave('error')
      setKeySaveErr(data.error || 'Failed to save key')
    } else {
      setKeySave('saved')
      setApiKeyInput('')
      // Re-fetch config
      fetch('/api/admin/check-config').then(r => r.json()).then(d => { if (!d.error) setConfig(d) })
      setTimeout(() => setKeySave('idle'), 3000)
    }
  }

  async function removeApiKey() {
    await fetch('/api/admin/claude-key', { method: 'DELETE' })
    fetch('/api/admin/check-config').then(r => r.json()).then(d => { if (!d.error) setConfig(d) })
  }

  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  const TOTAL_PHASES = 11

  async function runPhase(jobId: string): Promise<number | null> {
    const res = await fetch('/api/jobs/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const jobRes = await fetch(`/api/jobs/${jobId}`).then(r => r.json()).catch(() => ({}))
      throw new Error(jobRes.error || data.error || `Phase failed (HTTP ${res.status})`)
    }
    return data.nextPhase ?? null
  }

  async function generate() {
    setGen('running')
    setGenErr('')
    setGenRes(null)
    setGenStep(0)
    setPhaseLabel('Creating job…')

    try {
      const createRes = await fetch('/api/jobs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobType: 'weekly_report',
          params: { today: format(selectedDate, 'yyyy-MM-dd') }
        })
      })
      const { jobId } = await createRes.json()
      if (!jobId) throw new Error('Failed to create job')

      // poll for status label updates
      pollRef.current = setInterval(async () => {
        const statusRes = await fetch(`/api/jobs/${jobId}`)
        const job = await statusRes.json()
        if (job.phase_label) setPhaseLabel(job.phase_label)
        if (job.phase) setGenStep(job.phase)
      }, 3000)

      // run phases sequentially, each is one Vercel function call
      let nextPhase: number | null = 1
      while (nextPhase !== null) {
        nextPhase = await runPhase(jobId)
      }

      stopPoll()

      // fetch final job state for result
      const finalRes = await fetch(`/api/jobs/${jobId}`)
      const finalJob = await finalRes.json()

      if (finalJob.status === 'error') {
        setGen('error')
        setGenErr(finalJob.error || 'Generation failed.')
      } else {
        setGenStep(TOTAL_PHASES)
        setPhaseLabel('Complete ✓')
        setGen('success')
        setGenRes({ label: format(selectedDate, 'MMMM d, yyyy'), gmv: 0, reportDate: format(selectedDate, 'yyyy-MM-dd') })
      }
    } catch (e: any) {
      stopPoll()
      setGen('error')
      setGenErr(e?.message || 'Connection error. Try again.')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-gray-900">Weekly Report Admin</h1>
            <p className="text-xs text-gray-400 mt-0.5">Ruff Liners · TikTok Shop</p>
          </div>
          <a href="/dashboard" className="text-xs text-gray-400 hover:text-gray-600">← Dashboard</a>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">

        {/* Tab switcher */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          <button
            onClick={() => setTab('paste')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'paste' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Paste JSON
          </button>
          <button
            onClick={() => setTab('auto')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'auto' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Auto-Generate
          </button>
          <button
            onClick={() => setTab('manage')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'manage' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Manage
          </button>
        </div>

        {/* ── Report date selector (shown on paste + auto tabs) ── */}
        {tab !== 'manage' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">Week covered</p>
                <p className="text-xs text-gray-400 mt-0.5">Select the Sun–Sat week. Defaults to the most recently completed week.</p>
              </div>
              <span className="text-xs text-gray-400 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-full">
                Data: {dataWindow}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {mondays.map((m, i) => {
                const isSelected = format(m, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd')
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedDate(m)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      isSelected
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    {weekLabel(m)}{i === 0 ? ' ←' : ''}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── PASTE JSON TAB ── */}
        {tab === 'paste' && (
          <div className="space-y-4">

            {/* Instructions */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <h2 className="font-semibold text-gray-900">How to generate a report manually</h2>

              <div className="space-y-3">
                <div className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">Open Claude.ai with Euka connected</p>
                    <p className="text-xs text-gray-400 mt-0.5">Go to claude.ai, start a new conversation, and make sure the Euka MCP tool is enabled in your conversation settings.</p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">Copy and paste this prompt</p>
                    <p className="text-xs text-gray-400 mt-0.5 mb-2">Date windows are pre-filled for <strong>{format(selectedDate, 'MMM d, yyyy')}</strong> · {dataWindow}.</p>
                    <div className="relative">
                      <pre className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs text-gray-600 overflow-auto max-h-48 whitespace-pre-wrap leading-relaxed">
                        {prompt.slice(0, 300)}…
                      </pre>
                      <button
                        onClick={copyPrompt}
                        className="absolute top-2 right-2 bg-gray-900 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors font-medium"
                      >
                        {copied ? '✓ Copied!' : 'Copy full prompt'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">Wait for Claude to finish (~5–10 min)</p>
                    <p className="text-xs text-gray-400 mt-0.5">Claude will run ~18 Euka queries then write analysis for 4 focused sections. When done, it outputs a single large JSON block.</p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">4</span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">Copy the JSON and paste it below</p>
                    <p className="text-xs text-gray-400 mt-0.5">Select the entire JSON block Claude outputs (starting with <code className="bg-gray-100 px-1 rounded">{`{`}</code> and ending with <code className="bg-gray-100 px-1 rounded">{`}`}</code>), paste it below, and click Save.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Success */}
            {saveStatus === 'success' && saveResult && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
                <div className="text-3xl mb-2">✅</div>
                <h2 className="font-semibold text-gray-900">{saveResult.label}</h2>
                <p className="text-2xl font-bold text-green-600 mt-1">{fmt$(saveResult.gmv)}</p>
                <p className="text-xs text-gray-400 mt-1 mb-4">Saved to dashboard</p>
                <div className="flex gap-3 justify-center">
                  <a href={`/dashboard/${saveResult.reportDate}`}
                    className="bg-gray-900 text-white text-sm font-medium px-5 py-2 rounded-xl hover:bg-gray-800 transition-colors">
                    View report →
                  </a>
                  <button
                    onClick={() => { setSave('idle'); setJson(''); setSaveRes(null) }}
                    className="border border-gray-200 text-sm text-gray-500 px-4 py-2 rounded-xl hover:bg-gray-50"
                  >
                    Save another
                  </button>
                </div>
              </div>
            )}

            {/* Paste form */}
            {saveStatus !== 'success' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
                <label className="text-sm font-medium text-gray-700 block">Paste report JSON here</label>
                <textarea
                  value={json}
                  onChange={e => { setJson(e.target.value); setSave('idle'); setSaveErr('') }}
                  placeholder={'{\n  "meta": { "reportDate": "2026-05-27", ... },\n  "d30": { ... },\n  ...\n}'}
                  className="w-full h-48 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none"
                />
                {saveStatus === 'error' && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{saveError}</p>
                )}
                <button
                  onClick={saveReport}
                  disabled={!json.trim() || saveStatus === 'saving'}
                  className="w-full bg-gray-900 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-800 disabled:opacity-40 transition-colors"
                >
                  {saveStatus === 'saving' ? 'Saving…' : 'Save Report to Dashboard'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── AUTO-GENERATE TAB ── */}
        {tab === 'auto' && (
          <div className="space-y-4">

            {/* Config status card */}
            <div className={`rounded-2xl border p-5 ${config?.ready ? 'bg-green-50 border-green-100' : 'bg-white border-gray-100 shadow-sm'}`}>
              <div className="flex items-center justify-between mb-3">
                <p className={`text-sm font-semibold ${config?.ready ? 'text-green-800' : 'text-gray-900'}`}>
                  {config === null ? 'Checking configuration…' : config.ready ? '✓ Ready to auto-generate' : 'Setup required'}
                </p>
                {config?.ready && <span className="text-xs text-green-600 bg-green-100 px-2.5 py-1 rounded-full font-medium">All systems go</span>}
              </div>

              {config && (
                <div className="space-y-2">
                  {/* Anthropic API Key row */}
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className={config.anthropicKey.set ? 'text-green-500' : 'text-red-400'}>
                        {config.anthropicKey.set ? '✓' : '✗'}
                      </span>
                      <span className="text-gray-700 font-medium">Anthropic API Key</span>
                      {config.anthropicKey.masked && (
                        <span className="text-gray-400 font-mono">{config.anthropicKey.masked}</span>
                      )}
                      {config.anthropicKey.source === 'db' && (
                        <button onClick={removeApiKey} className="text-gray-300 hover:text-red-400 transition-colors text-xs">remove</button>
                      )}
                    </div>
                    {!config.anthropicKey.set && <span className="text-red-500 font-medium">Required</span>}
                  </div>

                  {/* Euka MCP URL row */}
                  <div className="flex items-center gap-2 text-xs">
                    <span className={config.eukaMcpUrl.set ? 'text-green-500' : 'text-amber-500'}>
                      {config.eukaMcpUrl.set ? '✓' : '✗'}
                    </span>
                    <span className="text-gray-700 font-medium">Euka MCP URL</span>
                    {!config.eukaMcpUrl.set && <span className="text-amber-600">Set EUKA_MCP_URL in Vercel environment variables</span>}
                  </div>

                  {/* Store ID row */}
                  <div className="flex items-center gap-2 text-xs">
                    <span className={config.eukaStoreId.set ? 'text-green-500' : 'text-amber-500'}>
                      {config.eukaStoreId.set ? '✓' : '✗'}
                    </span>
                    <span className="text-gray-700 font-medium">Euka Store ID</span>
                    {!config.eukaStoreId.set && <span className="text-amber-600">Set EUKA_STORE_ID in Vercel environment variables</span>}
                  </div>
                </div>
              )}
            </div>

            {/* API Key input — shown when key is not set or user wants to update */}
            {config && !config.anthropicKey.set && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Add Anthropic API Key</p>
                  <p className="text-xs text-gray-400 mt-0.5">Stored securely in your database. Starts with <code className="bg-gray-100 px-1 rounded">sk-ant-</code></p>
                </div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={apiKeyInput}
                      onChange={e => { setApiKeyInput(e.target.value); setKeySave('idle'); setKeySaveErr('') }}
                      placeholder="sk-ant-api03-..."
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 pr-16"
                    />
                    <button
                      onClick={() => setShowApiKey(s => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
                    >
                      {showApiKey ? 'hide' : 'show'}
                    </button>
                  </div>
                  <button
                    onClick={saveApiKey}
                    disabled={!apiKeyInput.trim() || keySaveState === 'saving'}
                    className="bg-gray-900 text-white rounded-xl px-4 py-2.5 text-sm font-semibold hover:bg-gray-800 disabled:opacity-40 transition-colors whitespace-nowrap"
                  >
                    {keySaveState === 'saving' ? 'Saving…' : keySaveState === 'saved' ? '✓ Saved' : 'Save Key'}
                  </button>
                </div>
                {keySaveState === 'error' && <p className="text-sm text-red-600">{keySaveErr}</p>}
                {keySaveState === 'saved' && <p className="text-sm text-green-600">Key saved — ready to generate!</p>}
              </div>
            )}

            {/* Update key button when already set */}
            {config?.anthropicKey.set && config.anthropicKey.source === 'db' && (
              <details className="bg-white rounded-2xl border border-gray-100 shadow-sm">
                <summary className="px-5 py-3 text-sm text-gray-500 cursor-pointer hover:text-gray-700 list-none flex items-center gap-2">
                  <span>↺</span> Update API key
                </summary>
                <div className="px-5 pb-4 space-y-3">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={apiKeyInput}
                        onChange={e => { setApiKeyInput(e.target.value); setKeySave('idle'); setKeySaveErr('') }}
                        placeholder="sk-ant-api03-..."
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 pr-16"
                      />
                      <button onClick={() => setShowApiKey(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600">
                        {showApiKey ? 'hide' : 'show'}
                      </button>
                    </div>
                    <button
                      onClick={saveApiKey}
                      disabled={!apiKeyInput.trim() || keySaveState === 'saving'}
                      className="bg-gray-900 text-white rounded-xl px-4 py-2.5 text-sm font-semibold hover:bg-gray-800 disabled:opacity-40 transition-colors whitespace-nowrap"
                    >
                      {keySaveState === 'saving' ? 'Saving…' : 'Update Key'}
                    </button>
                  </div>
                  {keySaveState === 'error' && <p className="text-sm text-red-600">{keySaveErr}</p>}
                  {keySaveState === 'saved' && <p className="text-sm text-green-600">Key updated.</p>}
                </div>
              </details>
            )}

            {/* Generate UI */}
            {genStatus === 'success' && genResult && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
                <div className="text-3xl mb-2">✅</div>
                <h2 className="font-semibold text-gray-900">{genResult.label}</h2>
                <p className="text-2xl font-bold text-green-600 mt-1">{fmt$(genResult.gmv)}</p>
                <p className="text-xs text-gray-400 mt-1 mb-4">Generated and saved</p>
                <div className="flex gap-3 justify-center">
                  <a href={`/dashboard/${genResult.reportDate}`}
                    className="bg-gray-900 text-white text-sm font-medium px-5 py-2 rounded-xl hover:bg-gray-800">
                    View report →
                  </a>
                  <button onClick={() => { setGen('idle'); setGenRes(null) }}
                    className="border border-gray-200 text-sm text-gray-500 px-4 py-2 rounded-xl hover:bg-gray-50">
                    Generate another
                  </button>
                </div>
              </div>
            )}

            {genStatus === 'running' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-gray-900">{phaseLabel || 'Starting…'}</p>
                    <p className="text-xs text-gray-400">Takes 8–15 minutes. Keep this tab open.</p>
                  </div>
                </div>
                <div className="space-y-2.5">
                  {GENERATE_STEPS.map((step, i) => (
                    <div key={step.id} className="flex items-center gap-3">
                      <span className="w-5 text-center text-sm">
                        {i < genStep ? <span className="text-green-500 font-bold">✓</span>
                          : i === genStep ? <span className="text-blue-500 animate-spin inline-block">⟳</span>
                          : <span className="text-gray-300">○</span>}
                      </span>
                      <span className={`text-sm transition-colors ${
                        i < genStep    ? 'text-gray-300 line-through' :
                        i === genStep  ? 'text-gray-900 font-medium' :
                        'text-gray-300'
                      }`}>{step.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {genStatus === 'error' && (
              <div className="space-y-3">
                <div className="bg-red-50 border border-red-100 rounded-2xl p-5">
                  <p className="font-semibold text-red-800 mb-1">Generation failed</p>
                  <p className="text-sm text-red-700">{genError}</p>
                </div>
                <button onClick={() => { setGen('idle'); setGenErr('') }}
                  className="w-full border border-gray-200 text-sm text-gray-600 py-2.5 rounded-xl hover:bg-gray-50">
                  Try again
                </button>
              </div>
            )}

            {(genStatus === 'idle' || genStatus === 'error') && genStatus !== 'error' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <div className="flex items-start justify-between mb-2">
                  <h2 className="font-semibold text-gray-900">Generate {format(selectedDate, 'MMMM d, yyyy')}</h2>
                  <span className="text-xs bg-gray-50 text-gray-400 border border-gray-100 px-2.5 py-1 rounded-full">
                    {dataWindow}
                  </span>
                </div>
                <p className="text-sm text-gray-400 mb-5">
                  Pulls all TikTok Shop data from Euka automatically and writes analysis for all 4 report sections. Takes ~5 minutes.
                </p>
                <button
                  onClick={generate}
                  className="w-full bg-gray-900 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-800 transition-colors"
                >
                  Generate This Week&apos;s Report
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── MANAGE TAB ── */}
        {tab === 'manage' && <ManageTab />}

      </main>
    </div>
  )
}
