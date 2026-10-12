import { useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../auth'
import { discard, retry, submit, useQueue } from '../offline'
import { Badge, Btn, Card, Field, Grid, Input, Msgs, Select, Table, Tabs, Textarea, dt, todayStr, useAction, useForm } from '../ui'
import { SiteField, label, useSiteChoice } from '../shared'

/** Shared wrapper: submit through the offline queue and report what happened. */
function useEntry(endpoint: string, what: string, onDone: () => void) {
  const a = useAction()
  const send = (payload: Record<string, unknown>) =>
    a.run(
      async () => {
        const r = await submit(endpoint, payload, what)
        onDone()
        return r
      },
      (r) => (r.queued ? 'Saved on this device. It will sync automatically when you are back online.' : r.result?.duplicate ? 'Already recorded earlier — no duplicate created.' : `Saved${r.result?.ref ? ` as ${r.result.ref}` : ''}.`),
    )
  return { a, send }
}

function FormShell({ onSubmit, a, children, cta }: { onSubmit: () => void; a: ReturnType<typeof useAction>; children: ReactNode; cta: string }) {
  const { formSiteId } = useAuth()
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        onSubmit()
      }}
      className="space-y-3"
    >
      <Msgs a={a} />
      {children}
      <Btn type="submit" disabled={a.busy || !formSiteId}>
        {a.busy ? 'Saving…' : cta}
      </Btn>
      {!formSiteId && <p className="text-xs text-stone-500">Loading your sites… (if this stays, you have not been assigned a site yet).</p>}
    </form>
  )
}

const now = () => new Date().toISOString()

function IntakeForm() {
  const { materials, suppliers } = useAuth()
  const { siteId, setPicked } = useSiteChoice()
  const f = useForm({ materialId: '', supplierId: '', sacks: '', notes: '' })
  const { a, send } = useEntry('/intakes', 'Ore intake', () => f.reset())
  return (
    <FormShell a={a} cta="Record intake" onSubmit={() => send({ siteId, materialId: f.v.materialId || materials[0]?.id, supplierId: f.v.supplierId || undefined, sacks: Number(f.v.sacks), notes: f.v.notes || undefined, receivedAt: now() })}>
      <Grid>
        <SiteField siteId={siteId} onChange={setPicked} />
        <Field label="Material">
          <Select value={f.v.materialId || materials[0]?.id || ''} onChange={f.set('materialId')}>
            {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label="Number of sacks"><Input type="number" inputMode="numeric" min={1} step={1} required value={f.v.sacks} onChange={f.set('sacks')} /></Field>
        <Field label="Source / supplier (optional)">
          <Select value={f.v.supplierId} onChange={f.set('supplierId')}>
            <option value="">— none —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
      </Grid>
      <Field label="Notes (optional)"><Textarea rows={2} value={f.v.notes} onChange={f.set('notes')} /></Field>
    </FormShell>
  )
}

function SaleForm() {
  const { materials, buyers } = useAuth()
  const { siteId, setPicked } = useSiteChoice()
  const f = useForm({ materialId: '', buyerId: '', buyerName: '', sacks: '', unitPrice: '', method: 'CASH', paymentRef: '' })
  const { a, send } = useEntry('/sales', 'Sale', () => f.reset())
  const total = Number(f.v.sacks || 0) * Number(f.v.unitPrice || 0)
  return (
    <FormShell a={a} cta="Record sale" onSubmit={() => send({ siteId, materialId: f.v.materialId || materials[0]?.id, buyerId: f.v.buyerId || undefined, buyerName: f.v.buyerId ? undefined : f.v.buyerName || undefined, sacks: Number(f.v.sacks), unitPrice: Number(f.v.unitPrice), method: f.v.method, paymentRef: f.v.paymentRef || undefined, soldAt: now() })}>
      <Grid>
        <SiteField siteId={siteId} onChange={setPicked} />
        <Field label="Material">
          <Select value={f.v.materialId || materials[0]?.id || ''} onChange={f.set('materialId')}>
            {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label="Buyer">
          <Select value={f.v.buyerId} onChange={f.set('buyerId')}>
            <option value="">Walk-in / type a name</option>
            {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        {!f.v.buyerId && <Field label="Buyer name (optional)"><Input value={f.v.buyerName} onChange={f.set('buyerName')} /></Field>}
        <Field label="Sacks"><Input type="number" inputMode="numeric" min={1} step={1} required value={f.v.sacks} onChange={f.set('sacks')} /></Field>
        <Field label="Unit price (KES per sack)"><Input type="number" inputMode="decimal" min={0} step="0.01" required value={f.v.unitPrice} onChange={f.set('unitPrice')} /></Field>
        <Field label="Payment method">
          <Select value={f.v.method} onChange={f.set('method')}>
            <option value="CASH">Cash</option>
            <option value="MPESA">M-Pesa</option>
          </Select>
        </Field>
        {f.v.method === 'MPESA' && <Field label="M-Pesa reference"><Input value={f.v.paymentRef} onChange={f.set('paymentRef')} /></Field>}
      </Grid>
      <p className="text-sm text-stone-600">Total: <strong className="tabular-nums">KES {total.toLocaleString('en-KE')}</strong></p>
    </FormShell>
  )
}

function WorkForm() {
  const { workers } = useAuth()
  const { siteId, setPicked } = useSiteChoice()
  const f = useForm({ workerId: '', workDate: todayStr(), basis: 'PER_SACK', task: '', quantity: '' })
  const { a, send } = useEntry('/work-records', 'Work record', () => f.reset({ workerId: f.v.workerId, workDate: f.v.workDate, basis: f.v.basis }))
  const unit = { PER_SACK: 'sacks', PER_SHIFT: 'shifts', PER_DAY: 'days', PER_HOUR: 'hours', PER_TASK: 'tasks' }[f.v.basis]
  return (
    <FormShell a={a} cta="Record work" onSubmit={() => send({ siteId, workerId: f.v.workerId, workDate: f.v.workDate, basis: f.v.basis, task: f.v.basis === 'PER_TASK' ? f.v.task : undefined, quantity: Number(f.v.quantity) })}>
      <p className="text-xs text-stone-500">The approved rate and amount due are worked out when the record is saved, then a supervisor verifies it before payout.</p>
      <Grid>
        <SiteField siteId={siteId} onChange={setPicked} />
        <Field label="Worker">
          <Select required value={f.v.workerId} onChange={f.set('workerId')}>
            <option value="">Select worker…</option>
            {workers.filter((w) => w.active !== false).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
        <Field label="Work date"><Input type="date" required max={todayStr()} value={f.v.workDate} onChange={f.set('workDate')} /></Field>
        <Field label="Pay basis">
          <Select value={f.v.basis} onChange={f.set('basis')}>
            {['PER_SACK', 'PER_SHIFT', 'PER_DAY', 'PER_HOUR', 'PER_TASK'].map((b) => <option key={b} value={b}>{label(b)}</option>)}
          </Select>
        </Field>
        {f.v.basis === 'PER_TASK' && <Field label="Task"><Input required value={f.v.task} onChange={f.set('task')} placeholder="e.g. Loading" /></Field>}
        <Field label={`Quantity (${unit})`}><Input type="number" inputMode="decimal" min={0} step="0.01" required value={f.v.quantity} onChange={f.set('quantity')} /></Field>
      </Grid>
    </FormShell>
  )
}

function FuelForm() {
  const { suppliers } = useAuth()
  const { siteId, setPicked } = useSiteChoice()
  const f = useForm({ kind: 'PURCHASE', category: 'GENERATOR', litres: '', cost: '', supplierId: '', entryDate: todayStr() })
  const { a, send } = useEntry('/fuel', 'Fuel entry', () => f.reset({ kind: f.v.kind, category: f.v.category }))
  return (
    <FormShell a={a} cta="Record fuel" onSubmit={() => send({ siteId, kind: f.v.kind, category: f.v.category, litres: Number(f.v.litres), cost: f.v.kind === 'PURCHASE' ? Number(f.v.cost) : undefined, supplierId: f.v.supplierId || undefined, entryDate: f.v.entryDate })}>
      <Grid>
        <SiteField siteId={siteId} onChange={setPicked} />
        <Field label="Type">
          <Select value={f.v.kind} onChange={f.set('kind')}>
            <option value="PURCHASE">Purchase (into store)</option>
            <option value="ISSUE">Issue (used)</option>
          </Select>
        </Field>
        <Field label="Category">
          <Select value={f.v.category} onChange={f.set('category')}>
            {['EQUIPMENT', 'GENERATOR', 'VEHICLE', 'OTHER'].map((c) => <option key={c} value={c}>{label(c)}</option>)}
          </Select>
        </Field>
        <Field label="Litres"><Input type="number" inputMode="decimal" min={0} step="0.01" required value={f.v.litres} onChange={f.set('litres')} /></Field>
        {f.v.kind === 'PURCHASE' && <Field label="Total cost (KES)"><Input type="number" inputMode="decimal" min={0} step="0.01" required value={f.v.cost} onChange={f.set('cost')} /></Field>}
        {f.v.kind === 'PURCHASE' && (
          <Field label="Supplier (optional)">
            <Select value={f.v.supplierId} onChange={f.set('supplierId')}>
              <option value="">— none —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Date"><Input type="date" required max={todayStr()} value={f.v.entryDate} onChange={f.set('entryDate')} /></Field>
      </Grid>
    </FormShell>
  )
}

function ExpenseForm() {
  const { suppliers } = useAuth()
  const { siteId, setPicked } = useSiteChoice()
  const f = useForm({ category: '', description: '', amount: '', method: 'CASH', paymentRef: '', supplierId: '' })
  const { a, send } = useEntry('/expenses', 'Expense', () => f.reset())
  return (
    <FormShell a={a} cta="Submit expense" onSubmit={() => send({ siteId, category: f.v.category, description: f.v.description || undefined, amount: Number(f.v.amount), method: f.v.method, paymentRef: f.v.paymentRef || undefined, supplierId: f.v.supplierId || undefined, spentAt: now() })}>
      <p className="text-xs text-stone-500">Expenses are sent for approval and reach the cashbook once approved.</p>
      <Grid>
        <SiteField siteId={siteId} onChange={setPicked} />
        <Field label="Category"><Input required list="exp-cats" value={f.v.category} onChange={f.set('category')} placeholder="e.g. Spare parts" />
          <datalist id="exp-cats">{['Spare parts', 'Food & water', 'Transport', 'Tools', 'Repairs', 'Other'].map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Amount (KES)"><Input type="number" inputMode="decimal" min={0} step="0.01" required value={f.v.amount} onChange={f.set('amount')} /></Field>
        <Field label="Paid by">
          <Select value={f.v.method} onChange={f.set('method')}>
            <option value="CASH">Cash</option>
            <option value="MPESA">M-Pesa</option>
          </Select>
        </Field>
        {f.v.method === 'MPESA' && <Field label="M-Pesa reference"><Input value={f.v.paymentRef} onChange={f.set('paymentRef')} /></Field>}
        <Field label="Supplier (optional)">
          <Select value={f.v.supplierId} onChange={f.set('supplierId')}>
            <option value="">— none —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
      </Grid>
      <Field label="Description (optional)"><Textarea rows={2} value={f.v.description} onChange={f.set('description')} /></Field>
    </FormShell>
  )
}

function SafetyForm() {
  const { siteId, setPicked } = useSiteChoice()
  const f = useForm({ kind: 'HAZARD', title: '', severity: 'LOW', description: '' })
  const { a, send } = useEntry('/safety', 'Safety record', () => f.reset())
  return (
    <FormShell a={a} cta="Report" onSubmit={() => send({ siteId, kind: f.v.kind, title: f.v.title, severity: f.v.severity, description: f.v.description || undefined, occurredAt: now() })}>
      <Grid>
        <SiteField siteId={siteId} onChange={setPicked} />
        <Field label="Type">
          <Select value={f.v.kind} onChange={f.set('kind')}>
            {['INCIDENT', 'HAZARD', 'INSPECTION'].map((k) => <option key={k} value={k}>{label(k)}</option>)}
          </Select>
        </Field>
        <Field label="Severity">
          <Select value={f.v.severity} onChange={f.set('severity')}>
            {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((k) => <option key={k} value={k}>{label(k)}</option>)}
          </Select>
        </Field>
        <Field label="Title"><Input required minLength={3} value={f.v.title} onChange={f.set('title')} /></Field>
      </Grid>
      <Field label="What happened / what was found"><Textarea rows={3} value={f.v.description} onChange={f.set('description')} /></Field>
    </FormShell>
  )
}

function SyncQueue() {
  const q = useQueue()
  return (
    <Card title="Device sync queue">
      <p className="mb-3 text-sm text-stone-600">
        {q.online ? 'Connected.' : 'No connection — entries are kept safely on this device.'}{' '}
        {q.items.length === 0 ? 'Everything you entered has reached the server.' : `${q.items.length} item(s) not yet confirmed by the server.`}
      </p>
      {q.items.length > 0 && (
        <Table
          rows={q.items}
          cols={[
            { head: 'Entry', cell: (i) => i.label },
            { head: 'Saved', cell: (i) => dt(i.createdAt) },
            { head: 'Status', cell: (i) => <Badge tone={i.status === 'failed' ? 'red' : i.status === 'syncing' ? 'blue' : 'amber'}>{i.status === 'failed' ? 'Needs attention' : i.status === 'syncing' ? 'Syncing' : 'Waiting'}</Badge> },
            { head: 'Detail', cell: (i) => <span className="text-xs text-stone-600">{i.error ?? ''}</span> },
            {
              head: '',
              cell: (i) => (
                <div className="flex gap-2">
                  {i.status === 'failed' && <Btn variant="ghost" className="!min-h-8 !px-2 !py-1" onClick={() => void retry(i.clientId)}>Retry</Btn>}
                  {i.status === 'failed' && <Btn variant="danger" className="!min-h-8 !px-2 !py-1" onClick={() => confirm('Discard this entry? It was never accepted by the server.') && void discard(i.clientId)}>Discard</Btn>}
                </div>
              ),
            },
          ]}
        />
      )}
    </Card>
  )
}

export default function FieldEntry() {
  const { can } = useAuth()
  const all: [string, boolean, () => ReactNode][] = [
    ['Ore intake', can('intake.create'), () => <IntakeForm />],
    ['Sale', can('sale.create'), () => <SaleForm />],
    ['Work record', can('work.create'), () => <WorkForm />],
    ['Fuel', can('fuel.create'), () => <FuelForm />],
    ['Expense', can('expense.create'), () => <ExpenseForm />],
    ['Safety', can('safety.write'), () => <SafetyForm />],
  ]
  const tabs = all.filter(([, ok]) => ok)
  const [tab, setTab] = useState(tabs[0]?.[0] ?? '')
  const current = tabs.find(([n]) => n === tab) ?? tabs[0]
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Field entry</h1>
      {current ? (
        <Card>
          <Tabs tabs={tabs.map(([n]) => n)} value={current[0]} onChange={setTab} />
          <div key={current[0]}>{current[2]()}</div>
        </Card>
      ) : (
        <p className="text-sm text-stone-500">Your role does not record field data.</p>
      )}
      <SyncQueue />
    </div>
  )
}
