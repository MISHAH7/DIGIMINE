import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { ApiError } from './api'

export const kes = (v: unknown) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 2 }).format(Number(v ?? 0))
export const num = (v: unknown) => new Intl.NumberFormat('en-KE', { maximumFractionDigits: 2 }).format(Number(v ?? 0))
export const dt = (v: unknown) => (v ? new Date(String(v)).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
export const dOnly = (v: unknown) => (v ? String(v).slice(0, 10) : '—')
/** Today's date in Nairobi (business date). */
export const todayStr = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10)

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-stone-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold tracking-wide text-stone-700 uppercase">{title}</h2>
          <div className="flex gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'ok' }
export function Btn({ variant = 'primary', className = '', ...p }: BtnProps) {
  const v = {
    primary: 'bg-stone-900 text-white hover:bg-stone-700',
    ok: 'bg-emerald-700 text-white hover:bg-emerald-600',
    danger: 'bg-red-700 text-white hover:bg-red-600',
    ghost: 'border border-stone-300 bg-white text-stone-800 hover:bg-stone-50',
  }[variant]
  return <button {...p} className={`min-h-10 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`} />
}

const inputCls = 'min-h-10 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-amber-600 focus:ring-2 focus:ring-amber-200 focus:outline-none'
export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-stone-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  )
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`${inputCls} ${p.className ?? ''}`} />
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`${inputCls} ${p.className ?? ''}`} />
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={`${inputCls} ${p.className ?? ''}`} />

const tones: Record<string, string> = {
  gray: 'bg-stone-100 text-stone-700',
  green: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800',
  blue: 'bg-sky-100 text-sky-800',
}
export const Badge = ({ tone = 'gray', children }: { tone?: keyof typeof tones; children: ReactNode }) => (
  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
)
export const statusTone = (s: string) =>
  ({ APPROVED: 'green', ACTIVE: 'green', CLOSED: 'green', PENDING: 'amber', OPEN: 'amber', IN_PROGRESS: 'blue', REJECTED: 'red', CANCELLED: 'red', FAILED: 'red', DOWN: 'red' })[s] ?? 'gray'

export interface Col<T> {
  head: string
  cell: (r: T) => ReactNode
  right?: boolean
}
export function Table<T>({ cols, rows, empty = 'Nothing here yet.' }: { cols: Col<T>[]; rows: T[] | null | undefined; empty?: string }) {
  if (!rows) return <p className="text-sm text-stone-500">Loading…</p>
  if (!rows.length) return <p className="text-sm text-stone-500">{empty}</p>
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-max text-left text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-xs text-stone-500 uppercase">
            {cols.map((c) => (
              <th key={c.head} className={`px-2 py-2 font-medium ${c.right ? 'text-right' : ''}`}>
                {c.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
              {cols.map((c) => (
                <td key={c.head} className={`px-2 py-2 align-top ${c.right ? 'text-right tabular-nums' : ''}`}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Tabs({ tabs, value, onChange }: { tabs: string[]; value: string; onChange: (t: string) => void }) {
  return (
    <div className="no-print mb-4 flex gap-1 overflow-x-auto border-b border-stone-200">
      {tabs.map((t) => (
        <button key={t} onClick={() => onChange(t)} className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${value === t ? 'border-amber-600 text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-800'}`}>
          {t}
        </button>
      ))}
    </div>
  )
}

export function Notice({ kind, children }: { kind: 'ok' | 'error' | 'info'; children: ReactNode }) {
  const c = { ok: 'border-emerald-200 bg-emerald-50 text-emerald-900', error: 'border-red-200 bg-red-50 text-red-900', info: 'border-amber-200 bg-amber-50 text-amber-900' }[kind]
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`mb-3 rounded-lg border px-3 py-2 text-sm ${c}`}>
      {children}
    </div>
  )
}

/** Load data with reload + error state. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reload = useCallback(() => {
    setError(null)
    return fnRef
      .current()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void reload(), deps)
  return { data, error, reload, setData }
}

/** Run an async action with busy/error/ok state. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const run = async <T,>(fn: () => Promise<T>, okMsg?: string | ((r: T) => string)): Promise<T | undefined> => {
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const r = await fn()
      if (okMsg) setOk(typeof okMsg === 'function' ? okMsg(r) : okMsg)
      return r
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, ok, run, clear: () => (setError(null), setOk(null)) }
}

export function Msgs({ a }: { a: { error: string | null; ok: string | null } }) {
  return (
    <>
      {a.error && <Notice kind="error">{a.error}</Notice>}
      {a.ok && <Notice kind="ok">{a.ok}</Notice>}
    </>
  )
}

export function useForm<T extends Record<string, string>>(initial: T) {
  const [v, setV] = useState<T>(initial)
  const set = (k: keyof T) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }))
  return { v, set, reset: (over: Partial<T> = {}) => setV({ ...initial, ...over }), setV }
}

export const Grid = ({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 | 4 }) => (
  <div className={`grid gap-3 sm:grid-cols-2 ${cols === 3 ? 'lg:grid-cols-3' : cols === 4 ? 'lg:grid-cols-4' : ''}`}>{children}</div>
)

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-stone-500 uppercase">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-stone-500">{sub}</div>}
    </div>
  )
}
