import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { Badge, Btn, Card, Field, Grid, Input, Msgs, Select, Table, Tabs, Textarea, dOnly, dt, kes, num, statusTone, todayStr, useAction, useForm, useLoad } from '../ui'
import { label, qs } from '../shared'

function Work() {
  const { siteId, nameOf, can, workers } = useAuth()
  const [workerId, setWorkerId] = useState('')
  const [unpaid, setUnpaid] = useState('')
  const a = useAction()
  const { data, error, reload } = useLoad(() => api<any[]>('GET', `/work-records${qs({ siteId, workerId, unpaid })}`), [siteId, workerId, unpaid])
  return (
    <Card title="Work records">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Worker"><Select value={workerId} onChange={(e) => setWorkerId(e.target.value)}><option value="">All workers</option>{workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
        <Field label="Show"><Select value={unpaid} onChange={(e) => setUnpaid(e.target.value)}><option value="">All</option><option value="1">Unpaid only</option></Select></Field>
      </div>
      <Msgs a={{ error, ok: null }} />
      <Msgs a={a} />
      <Table rows={data} empty="No work records." cols={[
        { head: 'Date', cell: (r) => dOnly(r.workDate) },
        { head: 'Worker', cell: (r) => nameOf('workers', r.workerId) },
        { head: 'Basis', cell: (r) => label(r.basis) + (r.task ? ` – ${r.task}` : '') },
        { head: 'Qty', right: true, cell: (r) => num(r.quantity) },
        { head: 'Rate', right: true, cell: (r) => kes(r.rate) },
        { head: 'Amount due', right: true, cell: (r) => <span title={`${r.quantity} × ${r.rate}`}>{kes(r.expectedAmount)}</span> },
        { head: 'Verified', cell: (r) => (r.verifiedAt ? <Badge tone="green">Verified</Badge> : can('work.verify') ? <Btn variant="ghost" className="!min-h-8 !px-2 !py-1" onClick={() => void a.run(async () => { await api('POST', `/work-records/${r.id}/verify`); void reload() }, 'Verified.')}>Verify</Btn> : <Badge tone="amber">Not yet</Badge>) },
        { head: 'Paid', cell: (r) => (r.payoutId ? <Badge tone="green">Paid</Badge> : <Badge>Unpaid</Badge>) },
      ]} />
    </Card>
  )
}

function Payouts() {
  const { siteId, nameOf, can, workers, formSiteId } = useAuth()
  const [workerId, setWorkerId] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const f = useForm({ method: 'CASH', paymentRef: '', amountPaid: '', shortfallNote: '' })
  const a = useAction()
  const site = siteId || formSiteId
  const due = useLoad(() => (workerId ? api<any[]>('GET', `/work-records${qs({ siteId: site, workerId, unpaid: 1, verified: 1 })}`) : Promise.resolve([])), [workerId, site])
  const list = useLoad(() => api<any[]>('GET', `/payouts${qs({ siteId })}`), [siteId])
  const sum = (due.data ?? []).filter((r) => picked.includes(r.id)).reduce((t, r) => t + Number(r.expectedAmount), 0)
  const paying = f.v.amountPaid === '' ? sum : Number(f.v.amountPaid)
  return (
    <div className="space-y-4">
      {can('payout.create') && (
        <Card title="Record a payout">
          <p className="mb-3 text-xs text-stone-500">Only supervisor-verified, unpaid work can be paid. Every payout goes for approval and posts to the cashbook once approved.</p>
          <Msgs a={a} />
          <Field label="Worker" className="mb-3 max-w-xs"><Select value={workerId} onChange={(e) => { setWorkerId(e.target.value); setPicked([]) }}><option value="">Select worker…</option>{workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
          {workerId && (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api('POST', '/payouts', { siteId: site, workerId, workRecordIds: picked, method: f.v.method, paymentRef: f.v.paymentRef || undefined, amountPaid: f.v.amountPaid === '' ? undefined : Number(f.v.amountPaid), shortfallNote: f.v.shortfallNote || undefined }); setPicked([]); f.reset(); void due.reload(); void list.reload() }, 'Payout recorded and sent for approval.') }}>
              <Table rows={due.data} empty="No verified, unpaid work for this worker." cols={[
                { head: '', cell: (r) => <input type="checkbox" aria-label="Include" checked={picked.includes(r.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))} /> },
                { head: 'Date', cell: (r) => dOnly(r.workDate) },
                { head: 'Work', cell: (r) => `${num(r.quantity)} × ${kes(r.rate)} (${label(r.basis)})` },
                { head: 'Due', right: true, cell: (r) => kes(r.expectedAmount) },
              ]} />
              {picked.length > 0 && (
                <>
                  <p className="text-sm">Amount due: <strong>{kes(sum)}</strong></p>
                  <Grid cols={3}>
                    <Field label="Paid by"><Select value={f.v.method} onChange={f.set('method')}><option value="CASH">Cash</option><option value="MPESA">M-Pesa</option></Select></Field>
                    {f.v.method === 'MPESA' && <Field label="M-Pesa reference"><Input value={f.v.paymentRef} onChange={f.set('paymentRef')} /></Field>}
                    <Field label="Amount paid" hint="Leave blank to pay the full amount due"><Input type="number" min={0} step="0.01" placeholder={String(sum)} value={f.v.amountPaid} onChange={f.set('amountPaid')} /></Field>
                  </Grid>
                  {paying !== sum && <Field label="Why does the amount differ? (required)"><Textarea rows={2} value={f.v.shortfallNote} onChange={f.set('shortfallNote')} /></Field>}
                  <Btn type="submit" disabled={a.busy}>Record payout of {kes(paying)}</Btn>
                </>
              )}
            </form>
          )}
        </Card>
      )}
      <Card title="Payout history">
        <Msgs a={{ error: list.error, ok: null }} />
        <Table rows={list.data} empty="No payouts yet." cols={[
          { head: 'Reference', cell: (p) => <span className="font-mono text-xs">{p.ref}</span> },
          { head: 'Paid', cell: (p) => dt(p.paidAt) },
          { head: 'Worker', cell: (p) => nameOf('workers', p.workerId) },
          { head: 'Due', right: true, cell: (p) => kes(p.expectedAmount) },
          { head: 'Paid', right: true, cell: (p) => kes(p.amountPaid) },
          { head: 'Method', cell: (p) => label(p.method) + (p.paymentRef ? ` · ${p.paymentRef}` : '') },
          { head: 'Status', cell: (p) => <Badge tone={statusTone(p.status)}>{label(p.status)}</Badge> },
        ]} />
      </Card>
    </div>
  )
}

function Workers() {
  const { can, reloadRefs } = useAuth()
  const a = useAction()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const { data, reload, error } = useLoad(() => api<any[]>('GET', '/workers'), [])
  return (
    <div className="space-y-4">
      {can('worker.manage') && (
        <Card title="Add worker">
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api('POST', '/workers', { name, phone: phone || undefined }); setName(''); setPhone(''); void reload(); void reloadRefs() }, 'Worker added.') }}>
            <Field label="Name"><Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            <Btn type="submit" disabled={a.busy}>Add</Btn>
          </form>
          <div className="mt-3"><Msgs a={a} /></div>
        </Card>
      )}
      <Card title="Workers">
        <Msgs a={{ error, ok: null }} />
        <Table rows={data} cols={[
          { head: 'Name', cell: (w) => w.name },
          { head: 'Phone', cell: (w) => w.phone ?? '—' },
          { head: 'Status', cell: (w) => <Badge tone={w.active ? 'green' : 'gray'}>{w.active ? 'Active' : 'Inactive'}</Badge> },
          { head: '', cell: (w) => can('worker.manage') && <Btn variant="ghost" className="!min-h-8 !px-2 !py-1" onClick={() => void a.run(async () => { await api('PATCH', `/workers/${w.id}`, { active: !w.active }); void reload(); void reloadRefs() })}>{w.active ? 'Deactivate' : 'Reactivate'}</Btn> },
        ]} />
      </Card>
    </div>
  )
}

function Rates() {
  const { can, sites } = useAuth()
  const a = useAction()
  const f = useForm({ basis: 'PER_SACK', task: '', siteId: '', rate: '', effectiveFrom: todayStr() })
  const { data, reload, error } = useLoad(() => api<any[]>('GET', '/rates'), [])
  return (
    <div className="space-y-4">
      {can('rates.manage') && (
        <Card title="Set an approved rate">
          <p className="mb-3 text-xs text-stone-500">Rates are never edited: add a new rate with an effective date. The most specific rate (task, then site) in force on the work date is used.</p>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api('POST', '/rates', { basis: f.v.basis, task: f.v.basis === 'PER_TASK' ? f.v.task : undefined, siteId: f.v.siteId || undefined, rate: Number(f.v.rate), effectiveFrom: f.v.effectiveFrom }); f.reset(); void reload() }, 'Rate saved.') }}>
            <Msgs a={a} />
            <Grid cols={4}>
              <Field label="Basis"><Select value={f.v.basis} onChange={f.set('basis')}>{['PER_SACK', 'PER_SHIFT', 'PER_DAY', 'PER_HOUR', 'PER_TASK'].map((b) => <option key={b} value={b}>{label(b)}</option>)}</Select></Field>
              {f.v.basis === 'PER_TASK' && <Field label="Task"><Input required value={f.v.task} onChange={f.set('task')} /></Field>}
              <Field label="Site"><Select value={f.v.siteId} onChange={f.set('siteId')}><option value="">All sites</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              <Field label="Rate (KES)"><Input type="number" min={0} step="0.01" required value={f.v.rate} onChange={f.set('rate')} /></Field>
              <Field label="Effective from"><Input type="date" required value={f.v.effectiveFrom} onChange={f.set('effectiveFrom')} /></Field>
            </Grid>
            <Btn type="submit" disabled={a.busy}>Save rate</Btn>
          </form>
        </Card>
      )}
      <Card title="Rate history">
        <Msgs a={{ error, ok: null }} />
        <Table rows={data} cols={[
          { head: 'Basis', cell: (r) => label(r.basis) + (r.task ? ` – ${r.task}` : '') },
          { head: 'Site', cell: (r) => sites.find((s) => s.id === r.siteId)?.name ?? 'All sites' },
          { head: 'Rate', right: true, cell: (r) => kes(r.rate) },
          { head: 'Effective from', cell: (r) => dOnly(r.effectiveFrom) },
        ]} />
      </Card>
    </div>
  )
}

export default function Labour() {
  const tabs = ['Work records', 'Payouts', 'Workers', 'Rates']
  const [tab, setTab] = useState(tabs[0]!)
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Labour</h1>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'Work records' && <Work />}
      {tab === 'Payouts' && <Payouts />}
      {tab === 'Workers' && <Workers />}
      {tab === 'Rates' && <Rates />}
    </div>
  )
}
