import { createStore, get, set } from 'idb-keyval'

const BASE = import.meta.env.VITE_API_URL ?? ''
const cacheStore = createStore('digimine-cache', 'kv')

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public issues?: { path: string; message: string }[],
  ) {
    super(message)
  }
}
/** Thrown when the server cannot be reached (offline, DNS, timeout). */
export class NetworkError extends Error {
  constructor() {
    super('Cannot reach the server')
  }
}

let token: string | null = (() => {
  try {
    return localStorage.getItem('dm_token')
  } catch {
    return null
  }
})()
let onUnauthorized: (() => void) | null = null

export function setToken(t: string | null) {
  token = t
  try {
    if (t) localStorage.setItem('dm_token', t)
    else localStorage.removeItem('dm_token')
  } catch {
    /* storage unavailable */
  }
}
export const getToken = () => token
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn)

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new NetworkError()
  }
  const ct = res.headers.get('content-type') ?? ''
  const data = ct.includes('json') ? await res.json().catch(() => null) : await res.text()
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') onUnauthorized?.()
    const issues = (data as any)?.issues as ApiError['issues']
    const msg = (data as any)?.error ?? `Request failed (${res.status})`
    throw new ApiError(res.status, issues?.length ? `${msg}: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}` : msg, (data as any)?.code, issues)
  }
  return data as T
}

/** GET that falls back to the last good copy when offline (reference data for field entry). */
export async function cachedGet<T = any>(path: string, scope = ''): Promise<T> {
  const key = `${scope}${path}`
  try {
    const data = await api<T>('GET', path)
    await set(key, data, cacheStore).catch(() => {})
    return data
  } catch (e) {
    if (e instanceof NetworkError) {
      const hit = await get<T>(key, cacheStore).catch(() => undefined)
      if (hit !== undefined) return hit
    }
    throw e
  }
}

export async function download(path: string, filename: string) {
  let res: Response
  try {
    res = await fetch(`${BASE}/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  } catch {
    throw new NetworkError()
  }
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.error ?? 'Download failed')
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
