import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { Badge, Btn, Card, Field, Grid, Input, Msgs, Select, Table, Tabs, Textarea, dOnly, dt, kes, num, todayStr, useAction, useForm, useLoad } from '../ui'
import { label, qs } from '../shared'

function Fuel() {
  const { siteId, nameOf } = useAuth()
  const { data, error } = useLoad(() => api<{ entries: any[]; onHandLitres: string }>('GET', `/fuel${qs({ siteId })}`), [siteId])
  return (
    <Card title="Fuel register" actions={data && <span className="text-sm text-stone-600">On hand: <strong>{num(data.onHandLitres)} L</strong></span>}>
      <p className="mb-3 text-xs text-stone-500">Record purchases and issues from Field entry → Fuel.</p>
      <Msgs a={{ error, ok: null }} />
      <Table rows={data?.entries} empty="No fuel entries." cols={[
        { head: 'Date', cell: (r) => dOnly(r.entryDate) },
        { head: 'Site', cell: (r) => nameOf('sites', r.siteId) },
        { head: 'Type', cell: (r) => <Badge tone={r.kind === 'PURCHASE' ? 'green' : 'amber'}>{label(r.kind)}</Badge> },
        { head: 'Category', cell: (r) => label(r.category) },
        { head: 'Litres', right: true, cell: (r) => num(r.litres) },
        { head: 'Cost', right: true, cell: (r) => (r.cost ? kes(r.cost) : '') },
      ]} />
    </Card>
  )
}

function Maintenance({ eq, onChanged }: { eq: any; onChanged: () => void }) {
  const { can } = useAuth()
  const f = useForm({ eventDate: todayStr(), description: '', cost: '0', downtimeHours: '0' })
  const a = useAction()
  const { data, reload } = useLoad(() => api<any[]>('GET', `/equipment/${eq.id}/maintenance`), [eq.id])
  return (
    <div className="mt-2 rounded-lg bg-stone-50 p-3">
      <Table rows={data} empty="No maintenance recorded." cols={[
        { head: 'Date', cell: (m) => dOnly(m.eventDate) },
        { head: 'Work done', cell: (m) => m.description },
        { head: 'Cost', right: true, cell: (m) => kes(m.cost) },
        { head: 'Downtime (h)', right: true, cell: (m) => num(m.downtimeHours) },
      ]} />
      {can('equipment.manage') && (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api('POST', `/equipment/${eq.id}/maintenance`, { eventDate: f.v.eventDate, description: f.v.description, cost: Number(f.v.cost), downtimeHours: Number(f.v.downtimeHours) }); f.reset(); void reload(); onChanged() }, 'Maintenance recorded.') }}>
          <Msgs a={a} />
          <Grid cols={4}>
            <Field label="Date"><Input type="date" max={todayStr()} required value={f.v.eventDate} onChange={f.set('eventDate')} /></Field>
            <Field label="Work done"><Input required minLength={3} value={f.v.description} onChange={f.set('description')} /></Field>
            <Field label="Cost (KES)"><Input type="number" min={0} step="0.01" value={f.v.cost} onChange={f.set('cost')} /></Field>
            <Field label="Downtime (hours)"><Input type="number" min={0} step="0.5" value={f.v.downtimeHours} onChange={f.set('downtimeHours')} /></Field>
          </Grid>
          <Btn type="submit" disabled={a.busy}>Add maintenance record</Btn>
        </form>
      )}
    </div>
  )
}

function Equipment() {
  const { siteId, formSiteId, nameOf, can } = useAuth()
  const f = useForm({ name: '', category: '' })
  const a = useAction()
  const [open, setOpen] = useState<string | null>(null)
  const { data, error, reload } = useLoad(() => api<any[]>('GET', `/equipment${qs({ siteId })}`), [siteId])
  return (
    <div className="space-y-4">
      {can('equipment.manage') && (
        <Card title="Register equipment">
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api('POST', '/equipment', { siteId: siteId || formSiteId, name: f.v.name, category: f.v.category }); f.reset(); void reload() }, 'Equipment added.') }}>
            <Field label="Name"><Input required minLength={2} value={f.v.name} onChange={f.set('name')} placeholder="e.g. Excavator 1" /></Field>
            <Field label="Category"><Input required minLength={2} value={f.v.category} onChange={f.set('category')} placeholder="e.g. Excavator" /></Field>
            <Btn type="submit" disabled={a.busy}>Add</Btn>
          </form>
          <div className="mt-3"><Msgs a={a} /></div>
        </Card>
      )}
      <Card title="Equipment register">
        <Msgs a={{ error, ok: null }} />
        <Table rows={data} empty="No equipment registered." cols={[
          { head: 'Name', cell: (e) => e.name },
          { head: 'Category', cell: (e) => e.category },
          { head: 'Site', cell: (e) => nameOf('sites', e.siteId) },
          { head: 'Hours', right: true, cell: (e) => num(e.hours) },
          { head: 'Status', cell: (e) => can('equipment.manage') ? (
            <Select aria-label="Status" className="!w-auto" value={e.status} onChange={(ev) => void api('PATCH', `/equipment/${e.id}`, { status: ev.target.value }).then(reload)}>
              {['ACTIVE', 'DOWN', 'RETIRED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </Select>
          ) : <Badge tone={e.status === 'ACTIVE' ? 'green' : e.status === 'DOWN' ? 'red' : 'gray'}>{label(e.status)}</Badge> },
          { head: '', cell: (e) => <Btn variant="ghost" className="!min-h-8 !px-2 !py-1" onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? 'Hide' : 'Maintenance'}</Btn> },
        ]} />
        {open && data?.find((e) => e.id === open) && <Maintenance eq={data.find((e) => e.id === open)} onChanged={() => void reload()} />}
      </Card>
    </div>
  )
}

function Safety() {
  const { siteId, nameOf, can } = useAuth()
  const [status, setStatus] = useState('')
  const a = useAction()
  const [edit, setEdit] = useState<{ id: string; correctiveAction: string; owner: string } | null>(null)
  const { data, error, reload } = useLoad(() => api<any[]>('GET', `/safety${qs({ siteId, status })}`), [siteId, status])
  const upd = (id: string, body: object) => a.run(async () => { await api('PATCH', `/safety/${id}`, body); setEdit(null); void reload() })
  return (
    <Card title="Safety register" actions={<Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="CLOSED">Closed</option></Select>}>
      <p className="mb-3 text-xs text-stone-500">Report new incidents, hazards and inspections from Field entry → Safety.</p>
      <Msgs a={{ error, ok: null }} />
      <Msgs a={a} />
      {edit && (
        <div className="mb-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <Field label="Corrective action"><Textarea rows={2} value={edit.correctiveAction} onChange={(e) => setEdit({ ...edit, correctiveAction: e.target.value })} /></Field>
          <Field label="Owner"><Input value={edit.owner} onChange={(e) => setEdit({ ...edit, owner: e.target.value })} /></Field>
          <div className="flex gap-2"><Btn onClick={() => void upd(edit.id, { correctiveAction: edit.correctiveAction || undefined, owner: edit.owner || undefined, status: 'IN_PROGRESS' })}>Save & mark in progress</Btn><Btn variant="ghost" onClick={() => setEdit(null)}>Cancel</Btn></div>
        </div>
      )}
      <Table rows={data} empty="No safety records." cols={[
        { head: 'When', cell: (r) => dt(r.occurredAt) },
        { head: 'Site', cell: (r) => nameOf('sites', r.siteId) },
        { head: 'Type', cell: (r) => label(r.kind) },
        { head: 'Title', cell: (r) => r.title },
        { head: 'Severity', cell: (r) => <Badge tone={r.severity === 'HIGH' || r.severity === 'CRITICAL' ? 'red' : r.severity === 'MEDIUM' ? 'amber' : 'gray'}>{label(r.severity)}</Badge> },
        { head: 'Action / owner', cell: (r) => <span className="text-xs">{r.correctiveAction ?? '—'}{r.owner ? ` (${r.owner})` : ''}</span> },
        { head: 'Status', cell: (r) => <Badge tone={r.status === 'CLOSED' ? 'green' : 'amber'}>{label(r.status)}</Badge> },
        { head: '', cell: (r) => can('safety.write') && r.status !== 'CLOSED' && (
          <div className="flex gap-2">
            <Btn variant="ghost" className="!min-h-8 !px-2 !py-1" onClick={() => setEdit({ id: r.id, correctiveAction: r.correctiveAction ?? '', owner: r.owner ?? '' })}>Action…</Btn>
            <Btn variant="ok" className="!min-h-8 !px-2 !py-1" onClick={() => void upd(r.id, { status: 'CLOSED' })}>Close</Btn>
          </div>
        ) },
      ]} />
    </Card>
  )
}

export default function SiteOps() {
  const tabs = ['Equipment', 'Fuel', 'Safety']
  const [tab, setTab] = useState(tabs[0]!)
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Equipment, fuel & safety</h1>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'Equipment' && <Equipment />}
      {tab === 'Fuel' && <Fuel />}
      {tab === 'Safety' && <Safety />}
    </div>
  )
}
