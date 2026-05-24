'use client'
import { MonthlyCharts as MC } from '@/lib/types'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell
} from 'recharts'

const G1 = '#3b82f6'
const G2 = '#22c55e'
const G3 = '#f59e0b'

const Legend = ({ items }: { items: { color: string; label: string }[] }) => (
  <div className="flex gap-3 mb-1">
    {items.map(it => (
      <span key={it.label} className="flex items-center gap-1 text-xs text-gray-500">
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: it.color }} />
        {it.label}
      </span>
    ))}
  </div>
)

const tierLegend = [{ color: G1, label: 'G1' }, { color: G2, label: 'G2' }, { color: G3, label: 'G3' }]

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

interface Props { data: MC }

export function MonthlyCharts({ data }: Props) {
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
  const crRows = buildRows(['g1','g2','g3'], { g1: data.crg1, g2: data.crg2, g3: data.crg3 })
  const ncRows = buildRows(['g1','g2','g3'], { g1: data.ncg1, g2: data.ncg2, g3: data.ncg3 })
  const vRows  = buildRows(['g1','g2','g3'], { g1: data.vg1,  g2: data.vg2,  g3: data.vg3  })
  const ggRows = buildRows(['g1','g2','g3'], { g1: data.gg1,  g2: data.gg2,  g3: data.gg3  })
  const retRows = buildRows(['ret'], { ret: data.ret })
  const mgRows = buildRows(['g1','g2','g3'], { g1: data.mg1, g2: data.mg2, g3: data.mg3 })
  const sgRows = buildRows(['g1','g2','g3'], { g1: data.sg1, g2: data.sg2, g3: data.sg3 })

  const ht = 160
  const axis = <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
  const yaxis = (fmt: (v: number) => string) =>
    <YAxis tickFormatter={fmt} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={38} />
  const tip = <Tooltip contentStyle={{ fontSize: 11 }} />

  return (
    <div className="space-y-6">
      {/* Top-line */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartCard title="Total GMV">
          <ResponsiveContainer width="100%" height={ht}>
            <BarChart data={gmvRows} barCategoryGap="30%">
              {axis}{yaxis(fmtDollar)}{tip}
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
                <Bar dataKey="g1" stackId="a" fill={G1} />
                <Bar dataKey="g2" stackId="a" fill={G2} />
                <Bar dataKey="g3" stackId="a" fill={G3} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="New Creators" legend={tierLegend}>
            <ResponsiveContainer width="100%" height={ht}>
              <BarChart data={ncRows} barCategoryGap="25%">
                {axis}{yaxis(String)}{tip}
                <Bar dataKey="g1" stackId="a" fill={G1} />
                <Bar dataKey="g2" stackId="a" fill={G2} />
                <Bar dataKey="g3" stackId="a" fill={G3} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Videos Posted" legend={tierLegend}>
            <ResponsiveContainer width="100%" height={ht}>
              <BarChart data={vRows} barCategoryGap="25%">
                {axis}{yaxis(String)}{tip}
                <Bar dataKey="g1" stackId="a" fill={G1} />
                <Bar dataKey="g2" stackId="a" fill={G2} />
                <Bar dataKey="g3" stackId="a" fill={G3} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="GMV by Tier" legend={tierLegend}>
            <ResponsiveContainer width="100%" height={ht}>
              <BarChart data={ggRows} barCategoryGap="25%">
                {axis}{yaxis(fmtDollar)}{tip}
                <Bar dataKey="g1" stackId="a" fill={G1} />
                <Bar dataKey="g2" stackId="a" fill={G2} />
                <Bar dataKey="g3" stackId="a" fill={G3} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Retention Rate">
            <ResponsiveContainer width="100%" height={ht}>
              <BarChart data={retRows} barCategoryGap="30%">
                {axis}{yaxis(v => v + '%')}{tip}
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
                <Bar dataKey="g1" stackId="a" fill={G1} />
                <Bar dataKey="g2" stackId="a" fill={G2} />
                <Bar dataKey="g3" stackId="a" fill={G3} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Samples Shipped" legend={tierLegend}>
            <ResponsiveContainer width="100%" height={ht}>
              <BarChart data={sgRows} barCategoryGap="25%">
                {axis}{yaxis(String)}{tip}
                <Bar dataKey="g1" stackId="a" fill={G1} />
                <Bar dataKey="g2" stackId="a" fill={G2} />
                <Bar dataKey="g3" stackId="a" fill={G3} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>
    </div>
  )
}
