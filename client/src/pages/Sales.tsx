import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { Badge, Btn, Card, Field, Input, Msgs, Select, Table, Textarea, dt, kes, num, statusTone, useAction, useLoad } from '../ui'
import { DateRange, label, qs } from '../shared'

interface Receipt {
  sale: any
  site: { name: string } | null
  material: { name: string } | null
  recordedBy?: string
}

function ReceiptView({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error } = useLoad(() => api<Receipt>('GET', `/sales/${id}/receipt`), [id])
  return (
    <Card title="Receipt" actions={<><Btn variant="ghost" onClick={() => window.print()}>Print / save PDF</Btn><Btn variant="ghost" onClick={onClose}>Close</Btn></>}>
      <Msgs a={{ error, ok: null }} />
      {data && (
        <div className="mx-auto max-w-sm space-y-1 text-sm">
          <div className="text-center">
            <div className="text-base font-semibold">{data.site?.name ?? 'Mining site'}</div>
            <div className="text-xs text-stone-500">Sales receipt {data.sale.status === 'CANCELLED' && '— CANCELLED'}</div>
          </div>
          <hr className="my-2" />
          {[
            ['Receipt no.', data.sale.ref],
            ['Date', dt(data.sale.soldAt)],
            ['Buyer', data.sale.buyerName],
            ['Material', data.material?.name ?? ''],
            ['Sacks', num(data.sale.sacks)],
            ['Unit price', kes(data.sale.unitPrice)],
            ['Paid by', label(data.sale.method) + (data.sale.paymentRef ? ` (${data.sale.paymentRef})` : '')],
            ['Served by', data.recordedBy ?? ''],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4"><span className="text-stone-500">{k}</span><span>{v}</span></div>
          ))}
          <hr className="my-2" />
          <div className="flex justify-between text-base font-semibold"><span>Total</span><span>{kes(data.sale.total)}</span></div>
        </div>
      )}
    </Card>
  )
}

export default function Sales() {
  const { siteId, nameOf, can } = useAuth()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [receipt, setReceipt] = useState<string | null>(null)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const a = useAction()
  const { data, error, reload } = useLoad(() => api<any[]>('GET', `/sales${qs({ siteId, q, status, from, to })}`), [siteId, q, status, from, to])
  const total = (data ?? []).filter((s) => s.status === 'ACTIVE').reduce((t, s) => t + Number(s.total), 0)
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Sales</h1>
      {receipt && <ReceiptView id={receipt} onClose={() => setReceipt(null)} />}
      <Card title="Sales register" actions={<span className="text-sm text-stone-600">Active total {kes(total)}</span>}>
        <div className="no-print mb-3 flex flex-wrap items-end gap-3">
          <Field label="Search"><Input placeholder="Receipt or buyer" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="ACTIVE">Active</option><option value="CANCELLED">Cancelled</option></Select></Field>
          <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        </div>
        <Msgs a={{ error, ok: null }} />
        <Msgs a={a} />
        {cancelId && (
          <div className="mb-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <Field label="Reason for cancelling this sale (required — needs approval)"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <div className="flex gap-2">
              <Btn variant="danger" disabled={a.busy || reason.trim().length < 5} onClick={() => void a.run(async () => { await api('POST', `/sales/${cancelId}/cancel`, { reason }); setCancelId(null); setReason(''); void reload() }, 'Cancellation sent for approval. The original sale is kept.')}>Request cancellation</Btn>
              <Btn variant="ghost" onClick={() => setCancelId(null)}>Back</Btn>
            </div>
          </div>
        )}
        <Table rows={data} empty="No sales found." cols={[
          { head: 'Receipt', cell: (s) => <span className="font-mono text-xs">{s.ref}</span> },
          { head: 'Date', cell: (s) => dt(s.soldAt) },
          { head: 'Site', cell: (s) => nameOf('sites', s.siteId) },
          { head: 'Buyer', cell: (s) => s.buyerName },
          { head: 'Sacks', right: true, cell: (s) => num(s.sacks) },
          { head: 'Total', right: true, cell: (s) => kes(s.total) },
          { head: 'Method', cell: (s) => label(s.method) },
          { head: 'Status', cell: (s) => <Badge tone={statusTone(s.status)}>{label(s.status)}</Badge> },
          { head: '', cell: (s) => (
            <div className="flex gap-2">
              <Btn variant="ghost" className="!min-h-8 !px-2 !py-1" onClick={() => setReceipt(s.id)}>Receipt</Btn>
              {s.status === 'ACTIVE' && can('sale.cancel') && <Btn variant="ghost" className="!min-h-8 !px-2 !py-1" onClick={() => setCancelId(s.id)}>Cancel…</Btn>}
            </div>
          ) },
        ]} />
      </Card>
    </div>
  )
}
