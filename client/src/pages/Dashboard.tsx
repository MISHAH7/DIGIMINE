import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { Card, Grid, Msgs, Notice, Stat, Table, kes, num, todayStr, useLoad } from '../ui'
import { DateRange, monthStart, qs } from '../shared'

export interface Summary {
  intake: { count: number; sacks: number }
  sales: { count: number; sacks: number; revenue: number; byMethod: Record<string, number>; cancelled: { count: number; value: number } }
  labour: { workRecords: number; expected: number; paidApproved: number; payoutsApproved: number; pendingPayouts: number; pendingPayoutAmount: number }
  fuel: { purchasedLitres: number; purchaseCost: number; issuedLitres: number }
  expenses: { total: number; byCategory: Record<string, number> }
  cash: { in: Record<string, number>; out: Record<string, number> }
  stockOnHand: { siteId: string; materialId: string; sacks: number }[]
  bySite: { sales: { siteId: string; sacks: number; revenue: number }[]; intake: { siteId: string; sacks: number }[] }
  margin: { revenue: number; costs: number; indicativeMargin: number; definition: string }
  pendingApprovals: number
}

export function useSummary(from: string, to: string) {
  const { siteId } = useAuth()
  return useLoad(() => api<Summary>('GET', `/reports/summary${qs({ siteId, from, to })}`), [siteId, from, to])
}

export default function Dashboard() {
  const { nameOf, user } = useAuth()
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(todayStr())
  const { data: s, error } = useSummary(from, to)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-stone-500">Figures are calculated from the underlying records; unapproved items are shown separately.</p>
        </div>
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>
      <Msgs a={{ error, ok: null }} />
      {!s ? (
        !error && <p className="text-sm text-stone-500">Loading…</p>
      ) : (
        <>
          {s.pendingApprovals > 0 && (
            <Notice kind="info">
              {s.pendingApprovals} item(s) are waiting for approval. <Link className="font-medium underline" to="/approvals">Review them</Link>.
            </Notice>
          )}
          <Grid cols={4}>
            <Stat label="Ore received" value={`${num(s.intake.sacks)} sacks`} sub={`${s.intake.count} deliveries`} />
            <Stat label="Sales" value={kes(s.sales.revenue)} sub={`${num(s.sales.sacks)} sacks · ${s.sales.count} sales`} />
            <Stat label="Labour paid (approved)" value={kes(s.labour.paidApproved)} sub={`${kes(s.labour.expected)} earned · ${s.labour.pendingPayouts} payout(s) pending`} />
            <Stat label="Indicative margin" value={kes(s.margin.indicativeMargin)} sub={`Costs ${kes(s.margin.costs)}`} />
          </Grid>
          <Grid cols={2}>
            <Card title="Stock on hand">
              <Table
                rows={s.stockOnHand}
                empty="No stock recorded."
                cols={[
                  { head: 'Site', cell: (r) => nameOf('sites', r.siteId) },
                  { head: 'Material', cell: (r) => nameOf('materials', r.materialId) },
                  { head: 'Sacks', right: true, cell: (r) => num(r.sacks) },
                ]}
              />
            </Card>
            <Card title="Receipts by method">
              <Table
                rows={['CASH', 'MPESA'].map((m) => ({ m, in: s.cash.in[m] ?? 0, out: s.cash.out[m] ?? 0 }))}
                cols={[
                  { head: 'Method', cell: (r) => (r.m === 'MPESA' ? 'M-Pesa' : 'Cash') },
                  { head: 'In', right: true, cell: (r) => kes(r.in) },
                  { head: 'Out', right: true, cell: (r) => kes(r.out) },
                ]}
              />
              <p className="mt-2 text-xs text-stone-500">Cancelled sales: {s.sales.cancelled.count} ({kes(s.sales.cancelled.value)})</p>
            </Card>
            <Card title="Fuel & expenses" className="sm:col-span-2">
              <ul className="space-y-1 text-sm">
                <li>Fuel bought: <strong>{num(s.fuel.purchasedLitres)} L</strong> ({kes(s.fuel.purchaseCost)})</li>
                <li>Fuel issued: <strong>{num(s.fuel.issuedLitres)} L</strong></li>
                <li>Approved expenses: <strong>{kes(s.expenses.total)}</strong></li>
              </ul>
            </Card>
          </Grid>
          {(user?.allSites || s.bySite.sales.length > 1) && (
            <Card title="Site comparison">
              <Table
                rows={Array.from(new Set([...s.bySite.sales.map((r) => r.siteId), ...s.bySite.intake.map((r) => r.siteId)]))}
                cols={[
                  { head: 'Site', cell: (id) => nameOf('sites', id) },
                  { head: 'Received (sacks)', right: true, cell: (id) => num(s.bySite.intake.find((r) => r.siteId === id)?.sacks ?? 0) },
                  { head: 'Sold (sacks)', right: true, cell: (id) => num(s.bySite.sales.find((r) => r.siteId === id)?.sacks ?? 0) },
                  { head: 'Revenue', right: true, cell: (id) => kes(s.bySite.sales.find((r) => r.siteId === id)?.revenue ?? 0) },
                ]}
              />
            </Card>
          )}
          <p className="text-xs text-stone-500">{s.margin.definition}</p>
        </>
      )}
    </div>
  )
}
