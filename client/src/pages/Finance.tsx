import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { Badge, Btn, Card, Field, Grid, Input, Msgs, Notice, Select, Stat, Table, Tabs, Textarea, dOnly, dt, kes, statusTone, todayStr, useAction, useForm, useLoad } from '../ui'
import { DateRange, label, monthStart, qs } from '../shared'

function Cashbook() {
  const { siteId, nameOf, can, formSiteId } = useAuth()
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(todayStr())
  const [method, setMethod] = useState('')
  const f = useForm({ direction: 'IN', category: '', amount: '', method: 'CASH', reference: '', note: '' })
  const a = useAction()
  const { data, error, reload } = useLoad(() => api<any[]>('GET', `/cash/entries${qs({ siteId, from, to, method })}`), [siteId, from, to, method])
  const rows = data ?? []
  const totalIn = rows.filter((r) => r.direction === 'IN').reduce((t, r) => t + Number(r.amount), 0)
  const totalOut = rows.filter((r) => r.direction === 'OUT').reduce((t, r) => t + Number(r.amount), 0)
  return (
    <div className="space-y-4">
      {can('cash.write') && (
        <Card title="Manual cashbook entry">
          <p className="mb-3 text-xs text-stone-500">Sales, payouts and approved expenses post automatically. Use this only for other movements (e.g. float top-up) and always give a note.</p>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api('POST', '/cash/entries', { siteId: siteId || formSiteId, direction: f.v.direction, category: f.v.category, amount: Number(f.v.amount), method: f.v.method, reference: f.v.reference || undefined, note: f.v.note }); f.reset(); void reload() }, 'Entry recorded.') }}>
            <Msgs a={a} />
            <Grid cols={4}>
              <Field label="Direction"><Select value={f.v.direction} onChange={f.set('direction')}><option value="IN">Money in</option><option value="OUT">Money out</option></Select></Field>
              <Field label="Category"><Input required minLength={2} value={f.v.category} onChange={f.set('category')} placeholder="e.g. Float top-up" /></Field>
              <Field label="Amount (KES)"><Input type="number" min={0} step="0.01" required value={f.v.amount} onChange={f.set('amount')} /></Field>
              <Field label="Method"><Select value={f.v.method} onChange={f.set('method')}><option value="CASH">Cash</option><option value="MPESA">M-Pesa</option></Select></Field>
            </Grid>
            <Grid><Field label="Reference (optional)"><Input value={f.v.reference} onChange={f.set('reference')} /></Field><Field label="Note (required)"><Input required minLength={3} value={f.v.note} onChange={f.set('note')} /></Field></Grid>
            <Btn type="submit" disabled={a.busy}>Record entry</Btn>
          </form>
        </Card>
      )}
      <Card title="Cashbook" actions={<span className="text-sm text-stone-600">In {kes(totalIn)} · Out {kes(totalOut)}</span>}>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
          <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="">Cash & M-Pesa</option><option value="CASH">Cash</option><option value="MPESA">M-Pesa</option></Select></Field>
        </div>
        <Msgs a={{ error, ok: null }} />
        <Table rows={data} empty="No entries in this period." cols={[
          { head: 'When', cell: (r) => dt(r.occurredAt) },
          { head: 'Site', cell: (r) => nameOf('sites', r.siteId) },
          { head: 'Category', cell: (r) => label(r.category) },
          { head: 'Method', cell: (r) => label(r.method) },
          { head: 'Reference', cell: (r) => r.reference ?? '' },
          { head: 'Source', cell: (r) => r.sourceType ?? '' },
          { head: 'In', right: true, cell: (r) => (r.direction === 'IN' ? kes(r.amount) : '') },
          { head: 'Out', right: true, cell: (r) => (r.direction === 'OUT' ? kes(r.amount) : '') },
        ]} />
      </Card>
    </div>
  )
}

function ShiftClose() {
  const { siteId, formSiteId, can, nameOf } = useAuth()
  const site = siteId || formSiteId
  const [date, setDate] = useState(todayStr())
  const f = useForm({ countedCash: '', mpesaCounted: '', explanation: '' })
  const a = useAction()
  const sum = useLoad(() => (site ? api<any>('GET', `/cash/summary${qs({ siteId: site, date })}`) : Promise.resolve(null)), [site, date])
  const closes = useLoad(() => api<any[]>('GET', `/cash/shift-closes${qs({ siteId })}`), [siteId])
  const s = sum.data
  const cashVar = s && f.v.countedCash !== '' ? Number(f.v.countedCash) - Number(s.expectedCash) : null
  const mpVar = s && f.v.mpesaCounted !== '' ? Number(f.v.mpesaCounted) - Number(s.mpesaExpected) : null
  const needsNote = (cashVar !== null && cashVar !== 0) || (mpVar !== null && mpVar !== 0)
  const closed = s?.shiftClose && s.shiftClose.status !== 'REJECTED'
  return (
    <div className="space-y-4">
      <Card title="Daily close & reconciliation">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Field label="Business date"><Input type="date" max={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <span className="pb-2 text-sm text-stone-600">{nameOf('sites', site)}</span>
        </div>
        <Msgs a={{ error: sum.error, ok: null }} />
        {s && (
          <>
            <Grid cols={4}>
              <Stat label="Opening cash" value={kes(s.openingCash)} />
              <Stat label="Expected cash" value={kes(s.expectedCash)} sub={`In ${kes(s.cashIn)} · Out ${kes(s.cashOut)}`} />
              <Stat label="Expected M-Pesa" value={kes(s.mpesaExpected)} sub={`In ${kes(s.mpesaIn)} · Out ${kes(s.mpesaOut)}`} />
              <Stat label="Status" value={closed ? label(s.shiftClose.status) : 'Open'} />
            </Grid>
            {closed ? (
              <div className="mt-3"><Notice kind="info">Closed with cash variance {kes(s.shiftClose.cashVariance)} and M-Pesa variance {kes(s.shiftClose.mpesaVariance)}.{s.shiftClose.explanation ? ` Explanation: ${s.shiftClose.explanation}` : ''}</Notice></div>
            ) : can('cash.write') ? (
              <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api('POST', '/cash/shift-close', { siteId: site, businessDate: date, countedCash: Number(f.v.countedCash), mpesaCounted: Number(f.v.mpesaCounted), explanation: f.v.explanation || undefined }); f.reset(); void sum.reload(); void closes.reload() }, 'Close submitted for approval.') }}>
                <Msgs a={a} />
                <Grid>
                  <Field label="Counted cash (KES)" hint={cashVar !== null ? `Variance ${kes(cashVar)}` : undefined}><Input type="number" min={0} step="0.01" required value={f.v.countedCash} onChange={f.set('countedCash')} /></Field>
                  <Field label="M-Pesa total per statement (KES)" hint={mpVar !== null ? `Variance ${kes(mpVar)}` : undefined}><Input type="number" min={0} step="0.01" required value={f.v.mpesaCounted} onChange={f.set('mpesaCounted')} /></Field>
                </Grid>
                {needsNote && <Field label="Explain the difference (required)"><Textarea rows={2} required value={f.v.explanation} onChange={f.set('explanation')} /></Field>}
                <Btn type="submit" disabled={a.busy}>Submit close for approval</Btn>
              </form>
            ) : null}
          </>
        )}
      </Card>
      <Card title="Previous closes">
        <Table rows={closes.data} empty="No closes yet." cols={[
          { head: 'Date', cell: (r) => dOnly(r.businessDate) },
          { head: 'Site', cell: (r) => nameOf('sites', r.siteId) },
          { head: 'Expected cash', right: true, cell: (r) => kes(r.expectedCash) },
          { head: 'Counted', right: true, cell: (r) => kes(r.countedCash) },
          { head: 'Cash variance', right: true, cell: (r) => <span className={Number(r.cashVariance) !== 0 ? 'font-medium text-red-700' : ''}>{kes(r.cashVariance)}</span> },
          { head: 'M-Pesa variance', right: true, cell: (r) => <span className={Number(r.mpesaVariance) !== 0 ? 'font-medium text-red-700' : ''}>{kes(r.mpesaVariance)}</span> },
          { head: 'Status', cell: (r) => <Badge tone={statusTone(r.status)}>{label(r.status)}</Badge> },
        ]} />
      </Card>
    </div>
  )
}

function Expenses() {
  const { siteId, nameOf } = useAuth()
  const [status, setStatus] = useState('')
  const { data, error } = useLoad(() => api<any[]>('GET', `/expenses${qs({ siteId, status })}`), [siteId, status])
  return (
    <Card title="Expenses & purchases" actions={<Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></Select>}>
      <p className="mb-3 text-xs text-stone-500">New expenses are entered from Field entry → Expense.</p>
      <Msgs a={{ error, ok: null }} />
      <Table rows={data} empty="No expenses." cols={[
        { head: 'Date', cell: (r) => dt(r.spentAt) },
        { head: 'Site', cell: (r) => nameOf('sites', r.siteId) },
        { head: 'Category', cell: (r) => r.category },
        { head: 'Description', cell: (r) => r.description ?? '' },
        { head: 'Supplier', cell: (r) => nameOf('suppliers', r.supplierId) },
        { head: 'Amount', right: true, cell: (r) => kes(r.amount) },
        { head: 'Method', cell: (r) => label(r.method) },
        { head: 'Status', cell: (r) => <Badge tone={statusTone(r.status)}>{label(r.status)}</Badge> },
      ]} />
    </Card>
  )
}

export default function Finance() {
  const tabs = ['Cashbook', 'Daily close', 'Expenses']
  const [tab, setTab] = useState(tabs[0]!)
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Cashbook & reconciliation</h1>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'Cashbook' && <Cashbook />}
      {tab === 'Daily close' && <ShiftClose />}
      {tab === 'Expenses' && <Expenses />}
    </div>
  )
}
