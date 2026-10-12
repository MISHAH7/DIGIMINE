import { useEffect, useState } from 'react'
import { createStore, del, entries, set } from 'idb-keyval'
import { ApiError, NetworkError, api, getToken } from './api'

/**
 * Offline queue (FR-030, FR-031, NFR-005, BR-011).
 * - Every create carries a client-generated `clientId` (idempotency key) so retries can never duplicate a record.
 * - Items are 'pending' (saved on this device only), 'failed' (server rejected — needs a person), or removed once confirmed.
 */
export type QueueStatus = 'pending' | 'syncing' | 'failed'
export interface QueueItem {
  clientId: string
  userId: string
  label: string
  endpoint: string
  payload: Record<string, unknown>
  createdAt: string
  status: QueueStatus
  attempts: number
  error?: string
}

const store = createStore('digimine-queue', 'items')
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
let currentUser = ''
export const setQueueUser = (id: string) => {
  currentUser = id
  notify()
}

export async function listQueue(): Promise<QueueItem[]> {
  const all = (await entries<string, QueueItem>(store)).map(([, v]) => v)
  return all.filter((i) => i.userId === currentUser).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

async function put(item: QueueItem) {
  await set(item.clientId, item, store)
  notify()
}

export async function discard(clientId: string) {
  await del(clientId, store)
  notify()
}

export async function retry(clientId: string) {
  const all = await listQueue()
  const it = all.find((i) => i.clientId === clientId)
  if (it) await put({ ...it, status: 'pending', error: undefined })
  void syncAll()
}

export type SubmitResult<T = any> = { queued: false; result: T } | { queued: true }

/** Send now when possible; otherwise keep it safely on the device and sync later. */
export async function submit<T = any>(endpoint: string, payload: Record<string, unknown>, label: string): Promise<SubmitResult<T>> {
  const clientId = (payload.clientId as string | undefined) ?? crypto.randomUUID()
  const body = { ...payload, clientId }
  const enqueue = async () => {
    await put({ clientId, userId: currentUser, label, endpoint, payload: body, createdAt: new Date().toISOString(), status: 'pending', attempts: 0 })
    return { queued: true } as const
  }
  if (!navigator.onLine) return enqueue()
  try {
    return { queued: false, result: await api<T>('POST', endpoint, body) }
  } catch (e) {
    if (e instanceof NetworkError) return enqueue()
    throw e
  }
}

let syncing = false
export async function syncAll(): Promise<void> {
  if (syncing || !navigator.onLine || !getToken()) return
  syncing = true
  try {
    for (const item of await listQueue()) {
      if (item.status === 'failed') continue
      await put({ ...item, status: 'syncing', attempts: item.attempts + 1 })
      try {
        await api('POST', item.endpoint, item.payload) // 200 "duplicate" counts as success
        await discard(item.clientId)
      } catch (e) {
        if (e instanceof NetworkError || (e instanceof ApiError && (e.status >= 500 || e.status === 401))) {
          await put({ ...item, status: 'pending', attempts: item.attempts + 1, error: e.message })
          break // try again later, keep order
        }
        await put({ ...item, status: 'failed', attempts: item.attempts + 1, error: (e as Error).message })
      }
    }
  } finally {
    syncing = false
  }
}

export function useQueue() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const refresh = () => void listQueue().then(setItems)
    listeners.add(refresh)
    refresh()
    const on = () => {
      setOnline(true)
      void syncAll()
    }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    const t = setInterval(() => void syncAll(), 30000)
    void syncAll()
    return () => {
      listeners.delete(refresh)
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      clearInterval(t)
    }
  }, [])
  return { items, online, pending: items.filter((i) => i.status !== 'failed').length, failed: items.filter((i) => i.status === 'failed').length }
}
