import type { Request, Response, NextFunction } from 'express'
import { ZodError, type ZodType } from 'zod'
import { Prisma, prisma, type Tx } from './db.js'
import type { Role } from './generated/prisma/enums.js'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message)
  }
}
export const badRequest = (m: string, code?: string) => new HttpError(400, m, code)
export const forbidden = (m = 'Not permitted', code = 'FORBIDDEN') => new HttpError(403, m, code)
export const notFound = (m = 'Not found') => new HttpError(404, m, 'NOT_FOUND')
export const conflict = (m: string, code = 'CONFLICT') => new HttpError(409, m, code)
export const unprocessable = (m: string, code = 'UNPROCESSABLE') => new HttpError(422, m, code)

export interface AuthUser {
  id: string
  name: string
  email: string
  role: Role
  siteIds: string[]
  allSites: boolean
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  return schema.parse(data)
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code })
    return
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
    return
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(409).json({ error: 'A record with the same unique value already exists', code: 'DUPLICATE' })
    return
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    res.status(404).json({ error: 'Record not found', code: 'NOT_FOUND' })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL' })
}

// ---- Nairobi business dates (UTC+3, no DST) -------------------------------------------
export const TZ_OFFSET = process.env.BUSINESS_TZ_OFFSET ?? '+03:00'
export const dayStart = (d: string) => new Date(`${d}T00:00:00${TZ_OFFSET}`)
export const dayEnd = (d: string) => new Date(dayStart(d).getTime() + 24 * 3600 * 1000)
export const dateOnly = (d: string) => new Date(`${d}T00:00:00Z`)
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function dateRange(from?: string, to?: string) {
  const r: { gte?: Date; lt?: Date } = {}
  if (from) r.gte = dayStart(from)
  if (to) r.lt = dayEnd(to)
  return Object.keys(r).length ? r : undefined
}

// ---- Reference numbers ----------------------------------------------------------------
export async function nextRef(tx: Tx, prefix: string, siteCode: string) {
  const key = `${prefix}-${siteCode}`
  const c = await tx.counter.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  })
  return `${key}-${String(c.value).padStart(6, '0')}`
}

// ---- Audit ----------------------------------------------------------------------------
export async function audit(
  tx: Tx | typeof prisma,
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  siteId: string | null,
  detail?: unknown,
) {
  await tx.auditLog.create({
    data: {
      actorId,
      action,
      entity,
      entityId,
      siteId,
      detail: detail === undefined ? undefined : (JSON.parse(JSON.stringify(detail)) as object),
    },
  })
}

// ---- Concurrency: serialize stock changes per site+material -----------------------------
export async function lockStock(tx: Tx, siteId: string, materialId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stock:${siteId}:${materialId}`}))`
}

export async function stockBalance(tx: Tx | typeof prisma, siteId: string, materialId: string) {
  const r = await tx.stockMovement.aggregate({
    where: { siteId, materialId },
    _sum: { sacks: true },
  })
  return r._sum.sacks ?? 0
}

// ---- Idempotency for offline sync (BR-011) ----------------------------------------------
export function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

export function pageParams(q: Record<string, unknown>) {
  const take = Math.min(Math.max(Number(q.limit ?? 100) || 100, 1), 500)
  const skip = Math.max(Number(q.offset ?? 0) || 0, 0)
  return { take, skip }
}

export const str = (v: unknown) => (typeof v === 'string' && v.length ? v : undefined)
