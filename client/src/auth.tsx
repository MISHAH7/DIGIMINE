import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, cachedGet, getToken, setToken, setUnauthorizedHandler } from './api'
import { setQueueUser } from './offline'

export interface User {
  id: string
  name: string
  email: string
  role: string
  siteIds: string[]
  allSites: boolean
}
export interface Ref {
  id: string
  name: string
  code?: string
  active?: boolean
  [k: string]: any
}

interface AuthCtx {
  user: User | null
  loading: boolean
  can: (perm: string) => boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  sites: Ref[]
  materials: Ref[]
  workers: Ref[]
  suppliers: Ref[]
  buyers: Ref[]
  siteId: string
  setSiteId: (id: string) => void
  /** Concrete site for forms: the selected site, or the first available. */
  formSiteId: string
  reloadRefs: () => Promise<void>
  nameOf: (kind: 'sites' | 'materials' | 'workers' | 'suppliers' | 'buyers', id?: string | null) => string
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [perms, setPerms] = useState<string[]>([])
  const [loading, setLoading] = useState(!!getToken())
  const [refs, setRefs] = useState<Record<string, Ref[]>>({ sites: [], materials: [], workers: [], suppliers: [], buyers: [] })
  const [siteId, setSiteIdState] = useState(() => {
    try {
      return localStorage.getItem('dm_site') ?? ''
    } catch {
      return ''
    }
  })

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    setPerms([])
    setQueueUser('')
  }, [])

  useEffect(() => setUnauthorizedHandler(logout), [logout])

  const reloadRefs = useCallback(async () => {
    const u = user?.id ?? ''
    const [sites, materials] = await Promise.all([cachedGet<Ref[]>('/sites', u), cachedGet<Ref[]>('/materials', u)])
    const opt = async (p: string) => (await cachedGet<Ref[]>(p, u).catch(() => [])) as Ref[]
    const [workers, suppliers, buyers] = await Promise.all([opt('/workers'), opt('/suppliers'), opt('/buyers')])
    setRefs({ sites, materials, workers, suppliers, buyers })
  }, [user?.id])

  useEffect(() => {
    if (!getToken()) return
    cachedGet<{ user: User; permissions: string[] }>('/auth/me')
      .then((r) => {
        setUser(r.user)
        setPerms(r.permissions)
        setQueueUser(r.user.id)
      })
      .catch(() => logout())
      .finally(() => setLoading(false))
  }, [logout])

  useEffect(() => {
    if (user) void reloadRefs().catch(() => {})
  }, [user, reloadRefs])

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string; user: User }>('POST', '/auth/login', { email, password })
    setToken(r.token)
    const me = await api<{ user: User; permissions: string[] }>('GET', '/auth/me')
    setUser(me.user)
    setPerms(me.permissions)
    setQueueUser(me.user.id)
  }, [])

  const setSiteId = (id: string) => {
    setSiteIdState(id)
    try {
      localStorage.setItem('dm_site', id)
    } catch {
      /* ignore */
    }
  }

  // Keep the selected site valid for this user.
  const activeSites = refs.sites.filter((s) => s.active !== false)
  const effectiveSiteId = useMemo(() => {
    if (siteId && refs.sites.some((s) => s.id === siteId)) return siteId
    if (user && !user.allSites && refs.sites.length === 1) return refs.sites[0]!.id
    return ''
  }, [siteId, refs.sites, user])

  const value: AuthCtx = {
    user,
    loading,
    can: (p) => perms.includes(p),
    login,
    logout,
    sites: activeSites,
    materials: refs.materials.filter((m) => m.active !== false),
    workers: refs.workers,
    suppliers: refs.suppliers,
    buyers: refs.buyers,
    siteId: effectiveSiteId,
    setSiteId,
    formSiteId: effectiveSiteId || activeSites[0]?.id || '',
    reloadRefs,
    nameOf: (kind, id) => (id ? (kind === 'sites' ? refs.sites : refs[kind]!).find((r) => r.id === id)?.name ?? '—' : '—'),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
