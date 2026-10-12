import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { Badge, Btn, Card, Field, Msgs, Select, Textarea, dt, kes, statusTone, useAction, useLoad } from '../ui'
import { label, qs } from '../shared'

export default function Approvals() {
  const { siteId, nameOf, can, user } = useAuth()
  const [status, setStatus] = useState('PENDING')
  const [open, setOpen] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const a = useAction()
  const { data, error, reload } = useLoad(() => api<any[]>('GET', `/approvals${qs({ siteId, status })}`), [siteId, status])
  const decide = (id: string, approved: boolean) =>
    a.run(async () => { await api('POST', `/approvals/${id}/decide`, { approved, comment: comment || undefined }); setOpen(null); setComment(''); void reload() }, approved ? 'Decision recorded.' : 'Rejected.')
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Approvals</h1>
        <Select aria-label="Status" className="!w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="">All</option>
        </Select>
      </div>
      <Msgs a={{ error, ok: null }} />
      <Msgs a={a} />
      {data?.length === 0 && <p className="text-sm text-stone-500">Nothing in this view.</p>}
      <div className="space-y-3">
        {data?.map((r) => {
          const mine = r.requestedById === user?.id
          const reviewed = r.decisions.some((d: any) => d.decidedById === user?.id)
          return (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge tone="blue">{label(r.type)}</Badge>
                    <Badge tone={statusTone(r.status)}>{label(r.status)}</Badge>
                    <span className="text-xs text-stone-500">{nameOf('sites', r.siteId)} · {dt(r.createdAt)}</span>
                  </div>
                  <p className="text-sm font-medium">{r.summary}</p>
                  {r.amount && <p className="text-xs text-stone-500">Amount {kes(r.amount)}</p>}
                  <p className="mt-1 text-xs text-stone-500">Approval step {Math.min(r.decisions.length + (r.status === 'PENDING' ? 1 : 0), r.requiredSteps)} of {r.requiredSteps}</p>
                  {r.decisions.map((d: any) => (
                    <p key={d.id} className="mt-1 text-xs text-stone-600">Step {d.step}: {d.approved ? 'approved' : 'rejected'} {dt(d.createdAt)}{d.comment ? ` — “${d.comment}”` : ''}</p>
                  ))}
                </div>
                {r.status === 'PENDING' && can('approve') && (
                  mine ? <span className="text-xs text-stone-500">You requested this — someone else must approve.</span>
                  : reviewed ? <span className="text-xs text-stone-500">You have reviewed this step.</span>
                  : <Btn variant="ghost" onClick={() => { setOpen(open === r.id ? null : r.id); setComment('') }}>Review</Btn>
                )}
              </div>
              {open === r.id && (
                <div className="mt-3 space-y-2 border-t border-stone-100 pt-3">
                  <Field label="Comment (required to reject)"><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
                  <div className="flex gap-2">
                    <Btn variant="ok" disabled={a.busy} onClick={() => void decide(r.id, true)}>Approve</Btn>
                    <Btn variant="danger" disabled={a.busy || !comment.trim()} onClick={() => void decide(r.id, false)}>Reject</Btn>
                  </div>
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
