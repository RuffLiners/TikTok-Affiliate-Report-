'use client'
import { WeeklyCharts as WC } from '@/lib/types'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell
} from 'recharts'

const L1 = '#94a3b8'
const L2 = '#3b82f6'
const L3 = '#22c55e'
const L4 = '#14b8a6'
const L5 = '#84cc16'
const L6 = '#f59e0b'
const L7 = '#f97316'

const Legend = ({ items }: { items: { color: string; label: string }[] }) => (
  <div className="flex gap-3 mb-1 flex-wrap">
    {items.map(it => (
      <span key={it.label} className="flex items-center gap-1 text-xs text-gray-500">
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: it.color }} />
        {it.label}
      </span>
    ))}
  </div>
)

const tierLegend = [
  { color: L1, label: 'L1' }, { color: L2, label: 'L2' }, { color: L3, label: 'L3' },
  { color: L4, label: 'L4' }, { color: L5, label: 'L5' }, { color: L6, label: 'L6' }, { color: L7, label: 'L7' }
]

const fmtK = (v: number) => v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'K' : String(v)
const fmtDollar = (v: number) => '$' + fmtK(v)

interface ChartCardProps {
  title: string
  legend?: { color: string; label: string }[]
  children: React.ReactNode
}

function ChartCard({ title, legend, children }: ChartCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-xs font-semibold text-gray-500 mb-2">{title}</p>
      {legend && <Legend items={legend} />}
      {children}
    </div>
  )
}

interface Props { data: WC }

export function WeeklyCharts({ data }: Props) {
  const labels = data.labels
  const n = labels.length

  const buildRows = <K extends string>(keys: K[], arrays: Record<K, number[]>) =>
    Array.from({ length: n }, (_, i) => {
      const row: Record<string, string | number> = { label: labels[i] }
      keys.forEach(k => { row[k] = arrays[k][i] })
      return row
    })

  const gmvRows = buildRows(['gmv'], { gmv: data.gmv })
  const viewRows = buildRows(['views'], { views: data.views })
  const TKEYS = ['l1','l2','l3','l4','l5','l6','l7'] as const
  const crRows = buildRows([...TKEYS], { l1: data.crl1??[], l2: data.crl2??[], l3: data.crl3??[], l4: data.crl4??[], l5: data.crl5??[], l6: data.crl6??[], l7: data.crl7??[] })
  const ncRows = buildRows([...TKEYS], { l1: data.ncl1??[], l2: data.ncl2??[], l3: data.ncl3??[], l4: data.ncl4??[], l5: data.ncl5??[], l6: data.ncl6??[], l7: data.ncl7??[] })
  const vRows  = buildRows([...TKEYS], { l1: data.vl1??[],  l2: data.vl2??[],  l3: data.vl3??[],  l4: data.vl4??[],  l5: data.vl5??[],  l6: data.vl6??[],  l7: data.vl7??[]  })
  const ggRows = buildRows([...TKEYS], { l1: data.gl1??[],  l2: data.gl2??[],  l3: data.gl3??[],  l4: data.gl4??[],  l5: data.gl5??[],  l6: data.gl6??[],  l7: data.gl7??[]  })
  const vwl = [data.vwl1??[], data.vwl2??[], data.vwl3??[], data.vwl4??[], data.vwl5??[], data.vwl6??[], data.vwl7??[]]
  const hasVwData = vwl.flat().some(v => v > 0)
  const vwRows = buildRows([...TKEYS], { l1: vwl[0], l2: vwl[1], l3: vwl[2], l4: vwl[3], l5: vwl[4], l6: vwl[5], l7: vwl[6] })
  const retRows = buildRows(['ret'], { ret: data.ret })
  const vidRows = buildRows(['vid'], { vid: data.vid })
  const mgRows = buildRows([...TKEYS], { l1: data.ml1??[], l2: data.ml2??[], l3: data.ml3??[], l4: data.ml4??[], l5: data.ml5??[], l6: data.ml6??[], l7: data.ml7??[] })
  const sgRows = buildRows([...TKEYS], { l1: data.sl1??[], l2: data.sl2??[], l3: data.sl3??[], l4: data.sl4??[], l5: data.sl5??[], l6: data.sl6??[], l7: data.sl7??[] })

  const ht = 160
  const axis = <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
  const yaxis = (fmt: (v: number) => string) =>
    <YAxis tickFormatter={fmt} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={38} />
  const fmtFull = (v: any) => Math.round(Number(v)).toLocaleString('en-US')
  const tierName = (n: any) => /^l[1-7]$/.test(String(n)) ? String(n).toUpperCase() : n
  const tip = <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: any, n: any) => [fmtFull(v), tierName(n)]} />
  const tip$ = <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: any, n: any) => ['$' + fmtFull(v), tierName(n)]} />
  const tipPct = <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: any) => Number(v).toFixed(1) + '%'} />

  return (
    <div className="space-y-6">
      {/* Top-line */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartCard title="Total GMV">
          <ResponsiveContainer width="100%" height={ht}>
            <BarChart data={gmvRows} barCategoryGap="30%">
              {axis}{yaxis(fmtDollar)}{tip$}
              <Bar dataKey="gmv" fill="#22c55e" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Total Views">
          <ResponsiveContainer width="100%" height={ht}>
            <BarChart data={viewRows} barCategoryGap="30%">
              {axis}{yaxis(fmtK)}{tip}
              <Bar dataKey="views" fill="#a855f7" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Creator metrics by tier */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Creator Metrics · by Tier</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartCard title="Creators Posted" legend={tierLegend}>
            <ResponsiveContainer width="100%" height={ht}>
              <BarChart data={crRows} barCategoryGap="25%">
                {axis}{yaxis(String)}{tip}
                <Bar dataKey="l1" stackId="a" fill={L1} />
                <Bar dataKey="l2" stackId="a" fill={L2} />
                <Bar dataKey="l3" stackId="a" fill={L3} />
                <Bar dataKey="l4" stackId="a" fill={L4} />
                <Bar dataKey="l5" stackId="a" fill={L5} />
                <Bar dataKey="l6" stackId="a" fill={L6} />
                <Bar dataKey="l7" stackId="a" fill={L7} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="New Creators" legend={tierLegend}>
            <ResponsiveContainer width="100%" height={ht}>
              <BarChart data={ncRows} barCategoryGap="25%">
                {axis}{yaxis(String)}{tip}
                <Bar dataKey="l1" stackId="a" fill={L1} />
                <Bar dataKey="l2" stackId="a" fill={L2} />
                <Bar dataKey="l3" stackId="a" fill={L3} />
                <Bar dataKey="l4" stackId="a" fill={L4} />
                <Bar dataKey="l5" stackId="a" fill={L5} />
                <Bar dataKey="l6" stackId="a" fill={L6} />
                <Bar dataKey="l7" stackId="a" fill={L7} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Videos Posted" legend={tierLegend}>
            <ResponsiveContainer width="100%" height={ht}>
              <BarChart data={vRows} barCategoryGap="25%">
                {axis}{yaxis(String)}{tip}
                <Bar dataKey="l1" stackId="a" fill={L1} />
                <Bar dataKey="l2" stackId="a" fill={L2} />
                <Bar dataKey="l3" stackId="a" fill={L3} />
                <Bar dataKey="l4" stackId="a" fill={L4} />
                <Bar dataKey="l5" stackId="a" fill={L5} />
                <Bar dataKey="l6" stackId="a" fill={L6} />
                <Bar dataKey="l7" stackId="a" fill={L7} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="GMV by Tier" legend={tierLegend}>
            <ResponsiveContainer width="100%" height={ht}>
              <BarChart data={ggRows} barCategoryGap="25%">
                {axis}{yaxis(fmtDollar)}{tip$}
                <Bar dataKey="l1" stackId="a" fill={L1} />
                <Bar dataKey="l2" stackId="a" fill={L2} />
                <Bar dataKey="l3" stackId="a" fill={L3} />
                <Bar dataKey="l4" stackId="a" fill={L4} />
                <Bar dataKey="l5" stackId="a" fill={L5} />
                <Bar dataKey="l6" stackId="a" fill={L6} />
                <Bar dataKey="l7" stackId="a" fill={L7} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Views by Tier" legend={tierLegend}>
            {hasVwData ? (
              <ResponsiveContainer width="100%" height={ht}>
                <BarChart data={vwRows} barCategoryGap="25%">
                  {axis}{yaxis(fmtK)}{tip}
                  <Bar dataKey="l1" stackId="a" fill={L1} />
                  <Bar dataKey="l2" stackId="a" fill={L2} />
                  <Bar dataKey="l3" stackId="a" fill={L3} />
                  <Bar dataKey="l4" stackId="a" fill={L4} />
                  <Bar dataKey="l5" stackId="a" fill={L5} />
                  <Bar dataKey="l6" stackId="a" fill={L6} />
                  <Bar dataKey="l7" stackId="a" fill={L7} radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center text-xs text-gray-400" style={{ height: ht }}>
                Views by tier not available for this report
              </div>
            )}
          </ChartCard>

          <ChartCard title="Retention Rate">
            <ResponsiveContainer width="100%" height={ht}>
              <BarChart data={retRows} barCategoryGap="30%">
                {axis}{yaxis(v => v + '%')}{tipPct}
                <Bar dataKey="ret" radius={[3,3,0,0]}>
                  {retRows.map((row, i) => {
                    const v = Number(row.ret)
                    const fill = v >= 38 ? '#22c55e' : v >= 30 ? '#f59e0b' : '#ef4444'
                    return <Cell key={i} fill={fill} />
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Total Videos">
            <ResponsiveContainer width="100%" height={ht}>
              <BarChart data={vidRows} barCategoryGap="30%">
                {axis}{yaxis(String)}{tip}
                <Bar dataKey="vid" fill="#6b7280" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>

      {/* Recruiting */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Recruiting · by Tier</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartCard title="Messages Sent" legend={tierLegend}>
            <ResponsiveContainer width="100%" height={ht}>
              <BarChart data={mgRows} barCategoryGap="25%">
                {axis}{yaxis(fmtK)}{tip}
                <Bar dataKey="l1" stackId="a" fill={L1} />
                <Bar dataKey="l2" stackId="a" fill={L2} />
                <Bar dataKey="l3" stackId="a" fill={L3} />
                <Bar dataKey="l4" stackId="a" fill={L4} />
                <Bar dataKey="l5" stackId="a" fill={L5} />
                <Bar dataKey="l6" stackId="a" fill={L6} />
                <Bar dataKey="l7" stackId="a" fill={L7} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Samples Shipped" legend={tierLegend}>
            <ResponsiveContainer width="100%" height={ht}>
              <BarChart data={sgRows} barCategoryGap="25%">
                {axis}{yaxis(String)}{tip}
                <Bar dataKey="l1" stackId="a" fill={L1} />
                <Bar dataKey="l2" stackId="a" fill={L2} />
                <Bar dataKey="l3" stackId="a" fill={L3} />
                <Bar dataKey="l4" stackId="a" fill={L4} />
                <Bar dataKey="l5" stackId="a" fill={L5} />
                <Bar dataKey="l6" stackId="a" fill={L6} />
                <Bar dataKey="l7" stackId="a" fill={L7} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>
    </div>
  )
}
