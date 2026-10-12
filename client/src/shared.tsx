import { useState } from 'react'
import { useAuth } from './auth'
import { Field, Input, Select, todayStr } from './ui'

/** Build a query string, skipping empty values. */
export const qs = (p: Record<string, string | number | undefined | null>) => {
  const s = Object.entries(p)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
  return s ? `?${s}` : ''
}

export const monthStart = () => todayStr().slice(0, 8) + '01'

/** Site picker used inside forms; defaults to the site chosen in the header. */
export function useSiteChoice() {
  const { formSiteId } = useAuth()
  const [picked, setPicked] = useState('')
  const siteId = picked || formSiteId
  return { siteId, setPicked }
}

export function SiteField({ siteId, onChange }: { siteId: string; onChange: (id: string) => void }) {
  const { sites } = useAuth()
  if (sites.length <= 1) return null
  return (
    <Field label="Site">
      <Select value={siteId} onChange={(e) => onChange(e.target.value)}>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
    </Field>
  )
}

export function DateRange({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div className="no-print flex flex-wrap items-end gap-3">
      <Field label="From">
        <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
      </Field>
      <Field label="To">
        <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
      </Field>
    </div>
  )
}

export const labels: Record<string, string> = {
  PER_SACK: 'Per sack',
  PER_SHIFT: 'Per shift',
  PER_DAY: 'Per day',
  PER_HOUR: 'Per hour',
  PER_TASK: 'Per task',
  SALE_CANCEL: 'Sale cancellation',
  STOCK_ADJUSTMENT: 'Stock adjustment',
  PAYOUT: 'Worker payout',
  EXPENSE: 'Expense',
  SHIFT_CLOSE: 'Shift close',
  SITE_MANAGER: 'Site manager',
  OWNER: 'Business owner',
  ADMIN: 'System administrator',
  CLERK: 'Field clerk',
  SUPERVISOR: 'Supervisor',
  FINANCE: 'Finance officer',
  SAFETY: 'Safety officer',
  AUDITOR: 'Auditor',
  MPESA: 'M-Pesa',
  CASH: 'Cash',
}
export const label = (k: string) => labels[k] ?? k.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
