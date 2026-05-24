'use client'
import { useState } from 'react'
import { format, subDays } from 'date-fns'

type SaveStatus = 'idle' | 'saving' | 'success' | 'error'
type GenStatus  = 'idle' | 'running' | 'success' | 'error'

const STORE_ID = '455ea4f9-a404-411b-b748-9ba1929efb93'

function buildClaudePrompt(today: Date): string {
  const gmvEnd   = subDays(today, 2)
  const gmvStart = subDays(gmvEnd, 29)
  const priorEnd  = subDays(gmvStart, 1)
  const priorStart = subDays(priorEnd, 29)
  const f = (d: Date) => format(d, 'yyyy-MM-dd')
  const fLabel = (d: Date) => format(d, 'MMM d')

  return `Run the Ruff Liners TikTok Shop weekly report for today ${format(today, 'MMMM d, yyyy')}.

Store ID: ${STORE_ID}

DATE WINDOWS — use these exactly:
- Current 30d: ${f(gmvStart)} to ${f(gmvEnd)}
- Prior 30d: ${f(priorStart)} to ${f(priorEnd)}
- 13 complete Sun–Sat weeks ending on the most recent Saturday before ${f(gmvEnd)}
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

ANALYSIS — after pulling all data, write for 3 sections:
- "d30": 4–5 paragraphs — headline, GMV drivers by tier, creator health + retention, GMV Max ROI, recruiting effectiveness, 30d forward projection
- "weekly": 3 paragraphs — 13-week arc, creator/content patterns, recruiting lag correlations
- "monthly": 3 paragraphs — 6-month growth rate, tier mix shifts, strategic outlook

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
    ]
  },
  "analysis": {
    "d30": "Write 4–5 paragraphs here. Use \\n\\n between paragraphs.",
    "weekly": "Write 3 paragraphs here. Use \\n\\n between paragraphs.",
    "monthly": "Write 3 paragraphs here. Use \\n\\n between paragraphs."
  }
}

Product name shortening: "Hard Bottom Backseat Extenders for Dogs with Door Protection" → "Back Seat Ext." · "XL Floor Cover for Full-Size Crew Cab Trucks with Fold Up Seats" → "XL Floor Cover" · "Travel Dog Bed for Car" → "Travel Dog Bed"`
}

const GENERATE_STEPS = [
  { id: 'kpis',     label: 'Pulling 30-day KPIs' },
  { id: 'tiers',    label: 'Breaking down creator tiers' },
  { id: 'tables',   label: 'Fetching top creators & videos' },
  { id: 'weekly',   label: 'Pulling 13 weeks of data' },
  { id: 'monthly',  label: 'Pulling 6 months of data' },
  { id: 'analysis', label: 'Writing report analysis' },
  { id: 'saving',   label: 'Saving to dashboard' },
]

export default function AdminPage() {
  const [tab, setTab]           = useState<'paste' | 'auto'>('paste')
  const [json, setJson]         = useState('')
  const [saveStatus, setSave]   = useState<SaveStatus>('idle')
  const [saveError, setSaveErr] = useState('')
  const [saveResult, setSaveRes] = useState<{ label: string; gmv: number; reportDate: string } | null>(null)
  const [copied, setCopied]     = useState(false)

  const [genStatus, setGen]     = useState<GenStatus>('idle')
  const [genError, setGenErr]   = useState('')
  const [genResult, setGenRes]  = useState<{ label: string; gmv: number; reportDate: string } | null>(null)
  const [genStep, setGenStep]   = useState(0)

  const today = new Date()
  const prompt = buildClaudePrompt(today)
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

  async function generate() {
    setGen('running')
    setGenErr('')
    setGenRes(null)
    setGenStep(0)

    const delays = [0, 20000, 45000, 80000, 130000, 200000, 260000]
    const timers = delays.map((ms, i) => setTimeout(() => setGenStep(i), ms))

    try {
      const res = await fetch('/api/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ today: format(today, 'yyyy-MM-dd') }),
        signal: AbortSignal.timeout(360000)
      })

      timers.forEach(clearTimeout)

      const data = await res.json().catch(() => ({ error: 'Unknown error' }))

      if (!res.ok) {
        setGen('error')
        setGenErr(data.error || 'Something went wrong.')
      } else {
        setGenStep(GENERATE_STEPS.length)
        setGen('success')
        setGenRes({ label: data.label, gmv: data.gmv, reportDate: data.reportDate })
      }
    } catch (e: any) {
      timers.forEach(clearTimeout)
      setGen('error')
      setGenErr(e?.name === 'TimeoutError'
        ? 'Timed out after 6 minutes. The report may still be processing — check the dashboard in a minute.'
        : 'Connection error. Try again.')
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
        </div>

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
                    <p className="text-xs text-gray-400 mt-0.5 mb-2">Date windows are pre-filled for today ({format(today, 'MMM d, yyyy')}).</p>
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
                    <p className="text-xs text-gray-400 mt-0.5">Claude will run ~18 Euka queries then write analysis for all 3 tabs. When done, it outputs a single large JSON block.</p>
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

            {/* Setup status */}
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5">
              <p className="text-sm font-semibold text-amber-800 mb-1">API key required</p>
              <p className="text-sm text-amber-700">
                Add <code className="bg-amber-100 px-1.5 py-0.5 rounded text-xs font-mono">ANTHROPIC_API_KEY</code>,{' '}
                <code className="bg-amber-100 px-1.5 py-0.5 rounded text-xs font-mono">EUKA_MCP_URL</code>, and{' '}
                <code className="bg-amber-100 px-1.5 py-0.5 rounded text-xs font-mono">EUKA_STORE_ID</code> to your Vercel environment variables, then redeploy.
                Once configured, this button pulls all data and writes the full report automatically.
              </p>
              <div className="mt-3 space-y-1 text-xs text-amber-700 font-mono bg-amber-100 rounded-lg p-3">
                <div>ANTHROPIC_API_KEY=sk-ant-...</div>
                <div>EUKA_MCP_URL=https://app.euka.ai/api/mcp</div>
                <div>EUKA_STORE_ID=455ea4f9-a404-411b-b748-9ba1929efb93</div>
              </div>
            </div>

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
                    <p className="font-semibold text-gray-900">Pulling data and writing analysis…</p>
                    <p className="text-xs text-gray-400">Takes 5–6 minutes. Don&apos;t close this tab.</p>
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
                  <h2 className="font-semibold text-gray-900">Generate {format(today, 'MMMM d, yyyy')}</h2>
                  <span className="text-xs bg-gray-50 text-gray-400 border border-gray-100 px-2.5 py-1 rounded-full">
                    {format(subDays(today, 31), 'MMM d')} – {format(subDays(today, 2), 'MMM d')}
                  </span>
                </div>
                <p className="text-sm text-gray-400 mb-5">
                  Pulls all TikTok Shop data from Euka automatically and writes analysis for all 3 report tabs. Takes ~5 minutes.
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
      </main>
    </div>
  )
}
