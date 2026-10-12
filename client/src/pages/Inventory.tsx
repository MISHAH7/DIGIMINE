import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { Badge, Btn, Card, Field, Grid, Input, Msgs, Select, Table, Tabs, Textarea, dt, num, useAction, useForm, useLoad } from '../ui'
import { DateRange, label, qs } from '../shared'

type Mv = { id: string; type: string; sacks: number; note?: string; occurredAt: string; balanceAfter: number }

function Ledger() {
  const { sites, materials, siteId } = useAuth()
  const [s, setS] = useState(siteId || sites[0]?.id || '')
  const [m, setM] = useState(materials[0]?.id || '')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const site = s || sites[0]?.id || ''
  const mat = m || materials[0]?.id || ''
  const { data, error } = useLoad(() => (site && mat ? api<{ openingBalance: number; closingBalance: number; movements: Mv[] }>('GET', `/inventory/ledger${qs({ siteId: site, materialId: mat, from, to })}`) : Promise.resolve(null)), [site, mat, from, to])
  return (
    <Card title="Stock ledger">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Site"><Select value={site} onChange={(e) => setS(e.target.value)}>{sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        <Field label="Material"><Select value={mat} onChange={(e) => setM(e.target.value)}>{materials.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>
      <Msgs a={{ error, ok: null }} />
      {data && (
        <>
          <p className="mb-2 text-sm text-stone-600">Opening balance: <strong>{num(data.openingBalance)}</strong> sacks · Closing balance: <strong>{num(data.closingBalance)}</strong> sacks</p>
          <Table rows={data.movements} empty="No movements in this period." cols={[
            { head: 'When', cell: (r) => dt(r.occurredAt) },
            { head: 'Type', cell: (r) => <Badge tone={r.sacks < 0 ? 'amber' : 'green'}>{label(r.type)}</Badge> },
            { head: 'Reference', cell: (r) => r.note ?? '' },
            { head: 'Sacks', right: true, cell: (r) => (r.sacks > 0 ? '+' : '') + num(r.sacks) },
            { head: 'Balance', right: true, cell: (r) => num(r.balanceAfter) },
          ]} />
        </>
      )}
    </Card>
  )
}

function Balances() {
  const { siteId, nameOf } = useAuth()
  const { data, error } = useLoad(() => api<{ siteId: string; materialId: string; sacks: number }[]>('GET', `/inventory/balances${qs({ siteId })}`), [siteId])
  return (
    <Card title="Stock on hand">
      <Msgs a={{ error, ok: null }} />
      <Table rows={data} empty="No stock movements recorded yet." cols={[
        { head: 'Site', cell: (r) => nameOf('sites', r.siteId) },
        { head: 'Material', cell: (r) => nameOf('materials', r.materialId) },
        { head: 'Sacks on hand', right: true, cell: (r) => <strong className={r.sacks < 0 ? 'text-red-700' : ''}>{num(r.sacks)}</strong> },
      ]} />
    </Card>
  )
}

function Opening({ onDone }: { onDone: () => void }) {
  const { sites, materials, siteId } = useAuth()
  const f = useForm({ siteId: siteId || sites[0]?.id || '', materialId: materials[0]?.id ?? '', sacks: '' })
  const a = useAction()
  return (
    <Card title="Set opening stock (once per site and material)">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api('POST', '/inventory/opening', { ...f.v, sacks: Number(f.v.sacks) }); onDone(); f.reset({ siteId: f.v.siteId }) }, 'Opening stock recorded.') }}>
        <Msgs a={a} />
        <Grid cols={3}>
          <Field label="Site"><Select value={f.v.siteId} onChange={f.set('siteId')}>{sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          <Field label="Material"><Select value={f.v.materialId} onChange={f.set('materialId')}>{materials.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          <Field label="Sacks"><Input type="number" min={0} step={1} required value={f.v.sacks} onChange={f.set('sacks')} /></Field>
        </Grid>
        <Btn type="submit" disabled={a.busy}>Set opening stock</Btn>
      </form>
    </Card>
  )
}

function Adjustments({ onDone }: { onDone: () => void }) {
  const { sites, materials, siteId, can } = useAuth()
  const f = useForm({ siteId: siteId || sites[0]?.id || '', materialId: materials[0]?.id ?? '', sacks: '', reason: '', evidence: '' })
  const a = useAction()
  const { data, reload } = useLoad(() => api<any[]>('GET', `/inventory/adjustments${qs({ siteId })}`), [siteId])
  return (
    <div className="space-y-4">
      {can('stock.adjust') && (
        <Card title="Request a stock adjustment">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api('POST', '/inventory/adjustments', { ...f.v, sacks: Number(f.v.sacks), evidence: f.v.evidence || undefined }); onDone(); void reload(); f.reset({ siteId: f.v.siteId }) }, 'Adjustment submitted for approval. Stock changes only once it is approved.') }}>
            <Msgs a={a} />
            <Grid cols={3}>
              <Field label="Site"><Select value={f.v.siteId} onChange={f.set('siteId')}>{sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
              <Field label="Material"><Select value={f.v.materialId} onChange={f.set('materialId')}>{materials.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
              <Field label="Change in sacks" hint="Use a minus sign to reduce stock"><Input type="number" step={1} required value={f.v.sacks} onChange={f.set('sacks')} /></Field>
            </Grid>
            <Field label="Reason (required)"><Textarea rows={2} required minLength={5} value={f.v.reason} onChange={f.set('reason')} /></Field>
            <Field label="Evidence / reference (optional)"><Input value={f.v.evidence} onChange={f.set('evidence')} /></Field>
            <Btn type="submit" disabled={a.busy}>Submit for approval</Btn>
          </form>
        </Card>
      )}
      <Card title="Adjustment history">
        <Table rows={data} empty="No adjustments." cols={[
          { head: 'Requested', cell: (r) => dt(r.createdAt) },
          { head: 'Sacks', right: true, cell: (r) => (r.sacks > 0 ? '+' : '') + r.sacks },
          { head: 'Reason', cell: (r) => r.reason },
          { head: 'Status', cell: (r) => <Badge tone={r.status === 'APPROVED' ? 'green' : r.status === 'REJECTED' ? 'red' : 'amber'}>{label(r.status ?? 'PENDING')}</Badge> },
        ]} />
      </Card>
    </div>
  )
}

function Intakes() {
  const { siteId, nameOf } = useAuth()
  const [q, setQ] = useState('')
  const { data, error } = useLoad(() => api<any[]>('GET', `/intakes${qs({ siteId, q })}`), [siteId, q])
  return (
    <Card title="Ore intake register" actions={<Input aria-label="Search reference" placeholder="Search reference" value={q} onChange={(e) => setQ(e.target.value)} />}>
      <Msgs a={{ error, ok: null }} />
      <Table rows={data} empty="No intakes found." cols={[
        { head: 'Reference', cell: (r) => <span className="font-mono text-xs">{r.ref}</span> },
        { head: 'Received', cell: (r) => dt(r.receivedAt) },
        { head: 'Site', cell: (r) => nameOf('sites', r.siteId) },
        { head: 'Material', cell: (r) => nameOf('materials', r.materialId) },
        { head: 'Supplier', cell: (r) => nameOf('suppliers', r.supplierId) },
        { head: 'Sacks', right: true, cell: (r) => num(r.sacks) },
      ]} />
    </Card>
  )
}

export default function Inventory() {
  const { can } = useAuth()
  const tabs = ['Stock', 'Ledger', 'Intakes', 'Adjustments']
  const [tab, setTab] = useState('Stock')
  const [k, setK] = useState(0)
  const bump = () => setK((n) => n + 1)
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Inventory</h1>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'Stock' && (
        <div className="space-y-4">
          <Balances key={k} />
          {can('stock.opening') && <Opening onDone={bump} />}
        </div>
      )}
      {tab === 'Ledger' && <Ledger key={k} />}
      {tab === 'Intakes' && <Intakes />}
      {tab === 'Adjustments' && <Adjustments onDone={bump} />}
    </div>
  )
}
