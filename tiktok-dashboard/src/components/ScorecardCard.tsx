'use client'
import { useState } from 'react'
import { Cell, LINES, LineDef, LineKey, Scorecard, MonthPeriod, WeekPeriod } from '@/lib/scorecard'

type Tab = 'all' | 'weekly' | 'monthly'

function fmtVal(def: LineDef, v: number): string {
  if (def.kind === 'money') return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (def.kind === 'ratio') return v.toFixed(2) + 'x'
  return v.toLocaleString('en-US')
}
const Chip = ({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'amber' | 'blue' }) => (
  <span className={`ml-1.5 align-middle text-[10px] leading-none px-1.5 py-0.5 rounded-full font-medium ${
    tone === 'amber' ? 'bg-amber-50 text-amber-700 border border-amber-200' : tone === 'blue' ? 'bg-blue-50 text-blue-700 border border-blue-100' : 'bg-gray-100 text-gray-500'}`}>{children}</span>
)

function CellView({ def, cell, value }: { def: LineDef; cell: Cell; value?: number | null }) {
  const v = value === undefined ? cell.value : value
  if (v == null) {
    return <span className="text-gray-300">no data{def.sellerCenter && !cell.confirmed && <Chip tone="amber">not yet confirmed</Chip>}</span>
  }
  return (
    <span className="text-gray-900 tabular-nums">
      {fmtVal(def, v)}
      {def.sellerCenter && !cell.confirmed && <Chip tone="amber">not yet confirmed</Chip>}
      {cell.source === 'manual' || cell.source === 'seller_center' ? <Chip tone="blue">{cell.source === 'manual' ? 'manual' : 'Seller Center'}</Chip> : null}
    </span>
  )
}
const Pct = ({ v }: { v: number | null }) => v == null ? <span className="text-gray-300">n/a</span>
  : <span className={v > 0 ? 'text-green-600' : v < 0 ? 'text-red-600' : 'text-gray-500'}>{v > 0 ? '+' : ''}{v}%</span>

const th = 'text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-2 whitespace-nowrap'
const td = 'px-3 py-2 text-sm whitespace-nowrap'
const RoiSub = ({ v }: { v: number | null }) => <div className="text-[10px] text-gray-400">ROI vs shop GMV {v == null ? 'n/a' : v.toFixed(2) + 'x'}</div>

function LabelCol({ def }: { def: LineDef }) {
  return <td className={`${td} text-gray-700 sticky left-0 bg-white`}><span className="text-gray-300 mr-2 tabular-nums">{def.n}</span>{def.label}</td>
}

function AllTime({ sc }: { sc: Scorecard }) {
  const p = sc.allTime
  return (
    <table className="w-full"><thead><tr><th className={th}>Line</th><th className={th}>All time since launch (Oct 2025 to {sc.dataThrough})</th></tr></thead>
      <tbody>{LINES.map(def => (
        <tr key={def.key} className="border-t border-gray-50"><LabelCol def={def} />
          <td className={td}><CellView def={def} cell={p.lines[def.key]} />{p.lines[def.key].note && p.lines[def.key].value != null && <span className="ml-2 text-[10px] text-gray-400">{p.lines[def.key].note}</span>}
            {def.key === 'gmvMaxRoi' && <RoiSub v={p.roiVsShopGmv} />}</td></tr>))}</tbody></table>
  )
}

function Weekly({ sc, all }: { sc: Scorecard; all: boolean }) {
  const w = all && sc.weeklyAll ? sc.weeklyAll : sc.weekly
  return (
    <div className="overflow-x-auto"><table className="w-full"><thead><tr>
      <th className={`${th} sticky left-0 bg-white`}>Line</th>
      <th className={th}>Week of {w[0].start}</th><th className={th}>Prior week</th><th className={th}>Change</th>
      {w.slice(1).map((x: WeekPeriod) => <th key={x.key} className={th}>{x.start.slice(5)}</th>)}
    </tr></thead><tbody>{LINES.map(def => (
      <tr key={def.key} className="border-t border-gray-50"><LabelCol def={def} />
        <td className={`${td} bg-gray-50/50`}><CellView def={def} cell={w[0].lines[def.key]} />{def.key === 'gmvMaxRoi' && <RoiSub v={w[0].roiVsShopGmv} />}</td>
        <td className={`${td} text-gray-500`}>{w[0].prior[def.key] == null ? <span className="text-gray-300">no data</span> : fmtVal(def, w[0].prior[def.key]!)}</td>
        <td className={td}><Pct v={w[0].changes[def.key]} /></td>
        {w.slice(1).map(x => <td key={x.key} className={`${td} text-gray-600`}><CellView def={def} cell={x.lines[def.key]} />{def.key === 'gmvMaxRoi' && <RoiSub v={x.roiVsShopGmv} />}</td>)}
      </tr>))}</tbody></table>
      <p className="text-[11px] text-gray-400 mt-2 px-3">Sunday to Saturday weeks, most recent complete week first. Percent change is vs the prior week. ROI = Gross Revenue / GMV Max spend; the revenue is on TikTok's co-funded basis, so it can exceed shop GMV. ROI vs shop GMV = shop GMV / spend.</p></div>
  )
}

function Monthly({ sc }: { sc: Scorecard }) {
  const cur: MonthPeriod = sc.monthly[0]
  const hist = sc.monthly.slice(1)
  return (
    <div className="space-y-4 overflow-x-auto">
      <table className="w-full"><thead><tr>
        <th className={`${th} sticky left-0 bg-white`}>Line</th>
        <th className={th}>{cur.key} month to date ({cur.daysElapsed} of {cur.daysInMonth} days)</th>
        {cur.partial && <th className={th}>Month-end estimate <Chip>straight-line estimate</Chip></th>}
      </tr></thead><tbody>{LINES.map(def => (
        <tr key={def.key} className="border-t border-gray-50"><LabelCol def={def} />
          <td className={`${td} bg-gray-50/50`}><CellView def={def} cell={cur.lines[def.key]} />{def.key === 'gmvMaxRoi' && <RoiSub v={cur.roiVsShopGmv} />}</td>
          {cur.partial && <td className={td}>
            {def.distinct ? <span className="text-gray-400 text-xs">month to date only</span>
              : cur.projected && cur.projected[def.key as LineKey] != null ? <span className="tabular-nums text-gray-900">{fmtVal(def, cur.projected[def.key]!)}</span>
              : <span className="text-gray-300">no data</span>}
            {def.key === 'gmvMaxRoi' && cur.partial && <RoiSub v={cur.projectedRoiVsShopGmv} />}
          </td>}
        </tr>))}</tbody></table>
      {cur.partial && <p className="text-[11px] text-gray-400 px-3">Estimate = (month to date / days elapsed) x days in month, recomputed on every report. ROI is projected revenue divided by projected spend. Counts of distinct people are not projected.</p>}
      <table className="w-full"><thead><tr><th className={`${th} sticky left-0 bg-white`}>Line</th>{hist.map(m => <th key={m.key} className={th}>{m.key}</th>)}</tr></thead>
        <tbody>{LINES.map(def => (
          <tr key={def.key} className="border-t border-gray-50"><LabelCol def={def} />
            {hist.map(m => <td key={m.key} className={`${td} text-gray-600`}><CellView def={def} cell={m.lines[def.key]} />{def.key === 'gmvMaxRoi' && <RoiSub v={m.roiVsShopGmv} />}</td>)}
          </tr>))}</tbody></table>
    </div>
  )
}

export function ScorecardCard({ scorecard, meta }: { scorecard: Scorecard | null; meta: { publishedAt: string | null; audit: string } | null }) {
  const [tab, setTab] = useState<Tab>('weekly')
  const [showAll, setShowAll] = useState(false)
  if (!scorecard) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4">
        <h2 className="text-base font-semibold text-gray-900">Scorecard</h2>
        <p className="text-xs text-gray-400 mt-1">No scorecard published yet. The Monday run publishes it; until then there is nothing to show.</p>
      </div>
    )
  }
  const warns = scorecard.issues.filter(i => i.severity === 'warn')
  const infos = scorecard.issues.filter(i => i.severity === 'info')
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Scorecard</h2>
          <p className="text-xs text-gray-400 mt-0.5">As of {scorecard.asOf}, data through {scorecard.dataThrough}{meta?.publishedAt ? ` · published ${meta.publishedAt.slice(0, 10)}` : ''} · audit {meta?.audit ?? 'n/a'}</p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {([['all', 'All time'], ['weekly', 'Weekly'], ['monthly', 'Monthly']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`text-xs font-medium px-3 py-1.5 rounded-md ${tab === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="px-2 py-3">
        {tab === 'all' && <AllTime sc={scorecard} />}
        {tab === 'weekly' && (
          <>
            {scorecard.weeklyAll && (
              <div className="px-3 pb-2"><button onClick={() => setShowAll(v => !v)} className="text-xs text-gray-500 underline">
                {showAll ? 'Show last 13 weeks' : `Show full year (${scorecard.weeklyAll.length} weeks)`}</button></div>
            )}
            <Weekly sc={scorecard} all={showAll} />
          </>
        )}
        {tab === 'monthly' && <Monthly sc={scorecard} />}
      </div>
      {scorecard.issues.length > 0 && (
        <div className="mx-5 mb-4 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
          <p className="text-xs font-semibold text-amber-800 mb-1">Issues ({warns.length} to act on{infos.length ? `, ${infos.length} for information` : ''})</p>
          <ul className="list-disc pl-4 space-y-0.5">{[...warns, ...infos].map(i => <li key={i.id} className={`text-xs ${i.severity === 'warn' ? 'text-amber-800' : 'text-gray-500'}`}>{i.text}</li>)}</ul>
        </div>
      )}
    </div>
  )
}
