import { useState, type FormEvent } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import { useQueue } from './offline'
import { Btn, Field, Input, Msgs, Select, useAction } from './ui'
import Dashboard from './pages/Dashboard'
import FieldEntry from './pages/FieldEntry'
import Inventory from './pages/Inventory'
import Sales from './pages/Sales'
import Labour from './pages/Labour'
import Finance from './pages/Finance'
import SiteOps from './pages/SiteOps'
import Approvals from './pages/Approvals'
import Reports from './pages/Reports'
import Admin from './pages/Admin'

function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const a = useAction()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void a.run(() => login(email, password))
  }
  return (
    <div className="flex min-h-full items-center justify-center bg-stone-900 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-xl">
        <div>
          <div className="text-xs font-semibold tracking-widest text-amber-700 uppercase">DIGIMINE</div>
          <h1 className="text-xl font-semibold">Mining site operations</h1>
          <p className="text-sm text-stone-500">Sign in to record and review site activity.</p>
        </div>
        <Msgs a={a} />
        <Field label="Email">
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Btn type="submit" disabled={a.busy} className="w-full">
          {a.busy ? 'Signing in…' : 'Sign in'}
        </Btn>
      </form>
    </div>
  )
}

export default function App() {
  const { user, loading, can, logout, sites, siteId, setSiteId } = useAuth()
  const q = useQueue()
  if (loading) return <div className="p-8 text-sm text-stone-500">Loading…</div>
  if (!user) return <Login />

  const canEnter = ['intake.create', 'sale.create', 'work.create', 'fuel.create', 'expense.create', 'safety.write'].some(can)
  const nav: [string, string, boolean][] = [
    ['/', 'Dashboard', can('business.read')],
    ['/field', 'Field entry', canEnter],
    ['/inventory', 'Inventory', can('business.read')],
    ['/sales', 'Sales', can('business.read')],
    ['/labour', 'Labour', can('business.read')],
    ['/finance', 'Cashbook', can('business.read')],
    ['/site-ops', 'Equipment & safety', can('business.read')],
    ['/approvals', 'Approvals', can('business.read')],
    ['/reports', 'Reports', can('business.read')],
    ['/admin', 'Admin', can('users.manage') || can('config.manage') || can('audit.read')],
  ]
  const home = can('business.read') ? '/' : canEnter ? '/field' : '/admin'

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="no-print bg-stone-900 text-stone-200 md:w-56 md:shrink-0">
        <div className="flex items-center justify-between px-4 py-3 md:block">
          <div>
            <div className="text-xs font-semibold tracking-widest text-amber-500 uppercase">DIGIMINE</div>
            <div className="hidden text-xs text-stone-400 md:block">Site operations</div>
          </div>
          <div className="text-right text-xs text-stone-400 md:mt-4 md:text-left">
            <div className="font-medium text-stone-100">{user.name}</div>
            <div>{user.role.replace('_', ' ').toLowerCase()}</div>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-4">
          {nav
            .filter(([, , ok]) => ok)
            .map(([to, name]) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) => `rounded-lg px-3 py-2 text-sm whitespace-nowrap ${isActive ? 'bg-amber-600 text-white' : 'hover:bg-stone-800'}`}
              >
                {name}
              </NavLink>
            ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 bg-white px-4 py-2">
          <div className="flex items-center gap-2">
            {(user.allSites || sites.length > 1) && (
              <Select aria-label="Site" className="!w-auto" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                <option value="">{user.allSites ? 'All sites' : 'All my sites'}</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
            {!user.allSites && sites.length === 1 && <span className="text-sm text-stone-600">{sites[0]!.name}</span>}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <NavLink to="/field" className={`rounded-full px-3 py-1 font-medium ${!q.online ? 'bg-red-100 text-red-800' : q.failed ? 'bg-red-100 text-red-800' : q.pending ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
              {!q.online ? 'Offline' : 'Online'}
              {q.pending > 0 && ` · ${q.pending} waiting to sync`}
              {q.failed > 0 && ` · ${q.failed} need attention`}
            </NavLink>
            <Btn variant="ghost" className="!min-h-8 !px-3 !py-1" onClick={logout}>
              Sign out
            </Btn>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <Routes>
            <Route path="/" element={can('business.read') ? <Dashboard /> : <Navigate to={home} replace />} />
            <Route path="/field" element={<FieldEntry />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/sales" element={<Sales />} />
            <Route path="/labour" element={<Labour />} />
            <Route path="/finance" element={<Finance />} />
            <Route path="/site-ops" element={<SiteOps />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<Navigate to={home} replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
