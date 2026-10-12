import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { Badge, Btn, Card, Field, Grid, Input, Msgs, Select, Table, Tabs, dt, useAction, useForm, useLoad } from '../ui'
import { label } from '../shared'

const ROLES = ['ADMIN', 'OWNER', 'SITE_MANAGER', 'CLERK', 'SUPERVISOR', 'FINANCE', 'SAFETY', 'AUDITOR']
const ALL_SITE_ROLES = ['OWNER', 'AUDITOR']

function Users() {
  const { sites, user } = useAuth()
  const f = useForm({ name: '', email: '', password: '', role: 'CLERK' })
  const [siteIds, setSiteIds] = useState<string[]>([])
  const a = useAction()
  const { data, error, reload } = useLoad(() => api<any[]>('GET', '/users'), [])
  const toggle = (id: string) => setSiteIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  return (
    <div className="space-y-4">
      <Card title="Create user">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api('POST', '/users', { ...f.v, siteIds: ALL_SITE_ROLES.includes(f.v.role) ? [] : siteIds }); f.reset(); setSiteIds([]); void reload() }, 'User created.') }}>
          <Msgs a={a} />
          <Grid cols={4}>
            <Field label="Full name"><Input required minLength={2} value={f.v.name} onChange={f.set('name')} /></Field>
            <Field label="Email"><Input type="email" required value={f.v.email} onChange={f.set('email')} /></Field>
            <Field label="Temporary password" hint="At least 8 characters"><Input type="password" required minLength={8} autoComplete="new-password" value={f.v.password} onChange={f.set('password')} /></Field>
            <Field label="Role"><Select value={f.v.role} onChange={f.set('role')}>{ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}</Select></Field>
          </Grid>
          {ALL_SITE_ROLES.includes(f.v.role) ? <p className="text-xs text-stone-500">This role can see all sites.</p> : (
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-stone-600">Sites this user can access</legend>
              <div className="flex flex-wrap gap-3">{sites.map((s) => <label key={s.id} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={siteIds.includes(s.id)} onChange={() => toggle(s.id)} />{s.name}</label>)}</div>
            </fieldset>
          )}
          <Btn type="submit" disabled={a.busy}>Create user</Btn>
        </form>
      </Card>
      <Card title="Users">
        <Msgs a={{ error, ok: null }} />
        <Table rows={data} cols={[
          { head: 'Name', cell: (u) => u.name },
          { head: 'Email', cell: (u) => u.email },
          { head: 'Role', cell: (u) => label(u.role) },
          { head: 'Sites', cell: (u) => (ALL_SITE_ROLES.includes(u.role) ? 'All' : u.siteIds.map((id: string) => sites.find((s) => s.id === id)?.name ?? id).join(', ') || '—') },
          { head: 'Status', cell: (u) => <Badge tone={u.active ? 'green' : 'gray'}>{u.active ? 'Active' : 'Disabled'}</Badge> },
          { head: '', cell: (u) => u.id !== user?.id && (
            <div className="flex gap-2">
              <Btn variant="ghost" className="!min-h-8 !px-2 !py-1" onClick={() => void a.run(async () => { await api('PATCH', `/users/${u.id}`, { active: !u.active }); void reload() })}>{u.active ? 'Disable' : 'Enable'}</Btn>
              <Btn variant="ghost" className="!min-h-8 !px-2 !py-1" onClick={() => { const p = prompt(`New password for ${u.name} (min 8 characters)`); if (p) void a.run(async () => { await api('PATCH', `/users/${u.id}`, { password: p }) }, 'Password changed.') }}>Reset password</Btn>
            </div>
          ) },
        ]} />
      </Card>
    </div>
  )
}

function Sites() {
  const { can, reloadRefs } = useAuth()
  const f = useForm({ code: '', name: '' })
  const m = useForm({ name: '', sackKg: '' })
  const a = useAction()
  const sites = useLoad(() => api<any[]>('GET', '/sites'), [])
  const mats = useLoad(() => api<any[]>('GET', '/materials'), [])
  return (
    <div className="space-y-4">
      {can('sites.manage') && (
        <Card title="Sites">
          <form className="mb-3 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api('POST', '/sites', f.v); f.reset(); void sites.reload(); void reloadRefs() }, 'Site added.') }}>
            <Field label="Code"><Input required minLength={2} maxLength={10} value={f.v.code} onChange={f.set('code')} placeholder="e.g. MWA" /></Field>
            <Field label="Name"><Input required minLength={2} value={f.v.name} onChange={f.set('name')} /></Field>
            <Btn type="submit" disabled={a.busy}>Add site</Btn>
          </form>
          <Msgs a={a} />
          <Table rows={sites.data} cols={[
            { head: 'Code', cell: (s) => s.code }, { head: 'Name', cell: (s) => s.name },
            { head: 'Status', cell: (s) => <Badge tone={s.active ? 'green' : 'gray'}>{s.active ? 'Active' : 'Inactive'}</Badge> },
            { head: '', cell: (s) => <Btn variant="ghost" className="!min-h-8 !px-2 !py-1" onClick={() => void a.run(async () => { await api('PATCH', `/sites/${s.id}`, { active: !s.active }); void sites.reload(); void reloadRefs() })}>{s.active ? 'Deactivate' : 'Activate'}</Btn> },
          ]} />
        </Card>
      )}
      {can('config.manage') && (
        <Card title="Materials / sack types">
          <form className="mb-3 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api('POST', '/materials', { name: m.v.name, sackKg: m.v.sackKg ? Number(m.v.sackKg) : undefined }); m.reset(); void mats.reload(); void reloadRefs() }, 'Material added.') }}>
            <Field label="Name"><Input required minLength={2} value={m.v.name} onChange={m.set('name')} placeholder="e.g. Graphite ore (50kg sack)" /></Field>
            <Field label="Sack weight (kg, optional)"><Input type="number" min={0} step="0.1" value={m.v.sackKg} onChange={m.set('sackKg')} /></Field>
            <Btn type="submit" disabled={a.busy}>Add material</Btn>
          </form>
          <Table rows={mats.data} cols={[
            { head: 'Name', cell: (x) => x.name }, { head: 'Sack kg', right: true, cell: (x) => x.sackKg ?? '—' },
            { head: 'Status', cell: (x) => <Badge tone={x.active ? 'green' : 'gray'}>{x.active ? 'Active' : 'Inactive'}</Badge> },
            { head: '', cell: (x) => <Btn variant="ghost" className="!min-h-8 !px-2 !py-1" onClick={() => void a.run(async () => { await api('PATCH', `/materials/${x.id}`, { active: !x.active }); void mats.reload(); void reloadRefs() })}>{x.active ? 'Deactivate' : 'Activate'}</Btn> },
          ]} />
        </Card>
      )}
    </div>
  )
}

function Thresholds() {
  const { can } = useAuth()
  const a = useAction()
  const { data, error } = useLoad(() => api<Record<string, number>>('GET', '/settings/approvalThresholds'), [])
  const [vals, setVals] = useState<Record<string, string>>({})
  const cur = (k: string) => vals[k] ?? String(data?.[k] ?? '')
  return (
    <Card title="Two-step approval thresholds">
      <p className="mb-3 text-xs text-stone-500">Requests at or above these values need two different approvers; smaller ones need one. Nobody can approve their own request. Stock adjustments are measured in sacks, the others in KES.</p>
      <Msgs a={{ error, ok: null }} />
      <Msgs a={a} />
      {data && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api('PUT', '/settings/approvalThresholds', Object.fromEntries(Object.keys(data).map((k) => [k, Number(cur(k))]))); setVals({}) }, 'Thresholds saved.') }}>
          <Grid cols={4}>
            {Object.keys(data).map((k) => (
              <Field key={k} label={`${label(k)} ${k === 'STOCK_ADJUSTMENT' ? '(sacks)' : '(KES)'}`}><Input type="number" min={1} step="any" disabled={!can('config.manage')} value={cur(k)} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} /></Field>
            ))}
          </Grid>
          {can('config.manage') && <Btn type="submit" disabled={a.busy}>Save thresholds</Btn>}
        </form>
      )}
    </Card>
  )
}

function Audit() {
  const [entity, setEntity] = useState('')
  const { data, error } = useLoad(() => api<any[]>('GET', `/audit?take=200${entity ? `&entity=${encodeURIComponent(entity)}` : ''}`), [entity])
  const users = useLoad(() => api<{ id: string; name: string }[]>('GET', '/audit/users'), [])
  const who = (id?: string) => users.data?.find((u) => u.id === id)?.name ?? (id ? id.slice(0, 8) : 'system')
  return (
    <Card title="Audit log" actions={<Select aria-label="Record type" value={entity} onChange={(e) => setEntity(e.target.value)}><option value="">All record types</option>{['Sale', 'Intake', 'StockAdjustment', 'WorkRecord', 'Payout', 'Expense', 'CashEntry', 'ShiftClose', 'ApprovalRequest', 'User', 'Setting', 'Report'].map((e) => <option key={e} value={e}>{e}</option>)}</Select>}>
      <Msgs a={{ error, ok: null }} />
      <Table rows={data} empty="No audit entries." cols={[
        { head: 'When', cell: (r) => dt(r.at) },
        { head: 'Who', cell: (r) => who(r.actorId) },
        { head: 'Action', cell: (r) => <Badge tone={/REJECT|CANCEL/.test(r.action) ? 'red' : /APPROVE/.test(r.action) ? 'green' : 'gray'}>{label(r.action)}</Badge> },
        { head: 'Record', cell: (r) => `${r.entity}${r.entityId ? ` · ${String(r.entityId).slice(0, 8)}` : ''}` },
        { head: 'Detail', cell: (r) => <code className="block max-w-md truncate text-xs text-stone-600" title={JSON.stringify(r.detail)}>{r.detail ? JSON.stringify(r.detail) : ''}</code> },
      ]} />
    </Card>
  )
}

export default function Admin() {
  const { can } = useAuth()
  const tabs = [can('users.manage') && 'Users', (can('sites.manage') || can('config.manage')) && 'Sites & materials', can('config.manage') && 'Approval thresholds', can('audit.read') && 'Audit log'].filter(Boolean) as string[]
  const [tab, setTab] = useState(tabs[0] ?? '')
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Administration</h1>
      <Tabs tabs={tabs} value={tabs.includes(tab) ? tab : tabs[0] ?? ''} onChange={setTab} />
      {tab === 'Users' && <Users />}
      {tab === 'Sites & materials' && <Sites />}
      {tab === 'Approval thresholds' && <Thresholds />}
      {tab === 'Audit log' && <Audit />}
    </div>
  )
}
