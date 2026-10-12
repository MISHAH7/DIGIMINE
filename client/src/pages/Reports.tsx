import { useState } from 'react'
import { download } from '../api'
import { useAuth } from '../auth'
import { Btn, Card, Grid, Msgs, Notice, Select, Table, kes, num, todayStr, useAction } from '../ui'
import { DateRange, label, monthStart } from '../shared'
import { useSummary } from './Dashboard'

const EXPORTS: [string, string][] = [['sales', 'Sales register'], ['intakes', 'Ore intake'], ['work', 'Work records'], ['payouts', 'Worker payouts'], ['cashbook', 'Cashbook'], ['fuel', 'Fuel']]

export default function Reports() {
  const { siteId, nameOf, sites } = useAuth()
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(todayStr())
  const { data: s, error } = useSummary(from, to)
  const a = useAction()
  const scope = siteId ? nameOf('sites', siteId) : 'All permitted sites'
  const rows = s
    ? ([
        ['Ore received (sacks)', num(s.intake.sacks)],
        ['Sales — sacks / value', `${num(s.sales.sacks)} / ${kes(s.sales.revenue)}`],
        ['Sales — cash', kes(s.sales.byMethod.CASH ?? 0)],
        ['Sales — M-Pesa', kes(s.sales.byMethod.MPESA ?? 0)],
        ['Cancelled sales', `${s.sales.cancelled.count} (${kes(s.sales.cancelled.value)})`],
        ['Labour — earned (all records)', kes(s.labour.expected)],
        ['Labour — paid & approved', kes(s.labour.paidApproved)],
        ['Labour — payouts pending approval', `${s.labour.pendingPayouts} (${kes(s.labour.pendingPayoutAmount)})`],
        ['Fuel bought / issued', `${num(s.fuel.purchasedLitres)} L (${kes(s.fuel.purchaseCost)}) / ${num(s.fuel.issuedLitres)} L`],
        ['Approved expenses', kes(s.expenses.total)],
        ...Object.entries(s.expenses.byCategory).map(([k, v]) => [`   • ${k}`, kes(v)]),
        ['Indicative operating margin', kes(s.margin.indicativeMargin)],
      ] as [string, string][])
    : []
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Reports</h1>
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>
      <Msgs a={{ error, ok: null }} />
      <Msgs a={a} />
      <Card title="Operations & financial summary" actions={<Btn variant="ghost" onClick={() => window.print()}>Print / save PDF</Btn>}>
        <p className="mb-3 text-xs text-stone-500">Period {from || 'start'} to {to || 'today'} · Scope: {scope} · Generated {new Date().toLocaleString('en-KE')} · Pending and rejected items are excluded from approved totals.</p>
        <Table rows={s ? rows : null} cols={[{ head: 'Measure', cell: (r) => r[0] }, { head: 'Value', right: true, cell: (r) => r[1] }]} />
        {s && <p className="mt-3 text-xs text-stone-500">{s.margin.definition}</p>}
      </Card>
      {s && s.sales.cancelled.count > 0 && <Notice kind="info">{s.sales.cancelled.count} sale(s) were cancelled in this period; they are excluded from sales totals but remain in the register.</Notice>}
      <Card title="Export to spreadsheet (CSV)">
        <div className="no-print flex flex-wrap gap-2">
          {EXPORTS.map(([t, n]) => (
            <Btn key={t} variant="ghost" disabled={a.busy} onClick={() => void a.run(() => download(`/reports/export?type=${t}&from=${from}&to=${to}${siteId ? `&siteId=${siteId}` : ''}`, `digimine-${t}-${from}_${to}.csv`), `${n} exported.`)}>{n}</Btn>
          ))}
        </div>
        <p className="mt-2 text-xs text-stone-500">Exports respect your site access and are recorded in the audit log.</p>
      </Card>
    </div>
  )
}
