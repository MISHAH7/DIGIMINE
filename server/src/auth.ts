import type { NextFunction, Request, Response } from 'express'
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from './db.js'
import { audit, forbidden, HttpError, parse, type AuthUser } from './lib.js'
import type { Role } from './generated/prisma/enums.js'

const JWT_SECRET = process.env.JWT_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : 'dev-only-secret-change-me')
if (!JWT_SECRET) throw new Error('JWT_SECRET must be set in production')

/** Roles whose visibility spans every site (SRS §5: Business Owner, Auditor). */
const ALL_SITE_ROLES: Role[] = ['OWNER', 'AUDITOR']

/** Permission matrix (SRS §5, proposed). Admin deliberately cannot approve or enter business data (BR-008). */
export const PERMS = {
  'users.manage': ['ADMIN'],
  'sites.manage': ['ADMIN'],
  'config.manage': ['ADMIN', 'OWNER', 'SITE_MANAGER'],
  'rates.manage': ['OWNER', 'SITE_MANAGER', 'FINANCE'],
  'intake.create': ['SITE_MANAGER', 'CLERK', 'SUPERVISOR'],
  'sale.create': ['SITE_MANAGER', 'CLERK'],
  'sale.cancel': ['SITE_MANAGER', 'FINANCE'],
  'stock.opening': ['SITE_MANAGER', 'OWNER'],
  'stock.adjust': ['SITE_MANAGER', 'SUPERVISOR'],
  'worker.manage': ['SITE_MANAGER', 'SUPERVISOR', 'FINANCE'],
  'work.create': ['SITE_MANAGER', 'SUPERVISOR', 'CLERK'],
  'work.verify': ['SITE_MANAGER', 'SUPERVISOR'],
  'payout.create': ['FINANCE', 'SITE_MANAGER'],
  'fuel.create': ['SITE_MANAGER', 'CLERK', 'SUPERVISOR'],
  'equipment.manage': ['SITE_MANAGER', 'SUPERVISOR'],
  'expense.create': ['SITE_MANAGER', 'FINANCE', 'CLERK'],
  'cash.write': ['FINANCE', 'SITE_MANAGER'],
  approve: ['OWNER', 'SITE_MANAGER', 'FINANCE'],
  'safety.write': ['SAFETY', 'SITE_MANAGER', 'SUPERVISOR', 'CLERK'],
  'audit.read': ['OWNER', 'AUDITOR', 'ADMIN'],
  'business.read': ['OWNER', 'SITE_MANAGER', 'CLERK', 'SUPERVISOR', 'FINANCE', 'SAFETY', 'AUDITOR'],
} as const satisfies Record<string, readonly Role[]>
export type Perm = keyof typeof PERMS

export const can = (role: Role, perm: Perm) => (PERMS[perm] as readonly Role[]).includes(role)

export function requirePerm(perm: Perm) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new HttpError(401, 'Authentication required', 'UNAUTHENTICATED')
    if (!can(req.user.role, perm)) throw forbidden(`Role ${req.user.role} cannot perform ${perm}`)
    next()
  }
}

/** Server-side site enforcement (NFR-002, AC-001). */
export function assertSite(user: AuthUser, siteId: string) {
  if (!user.allSites && !user.siteIds.includes(siteId)) throw forbidden('No access to this site', 'SITE_FORBIDDEN')
}

/** Prisma `where` fragment restricting a query to sites the user may see, optionally narrowed to one. */
export function siteWhere(user: AuthUser, requested?: string): { siteId?: string | { in: string[] } } {
  if (requested) {
    assertSite(user, requested)
    return { siteId: requested }
  }
  return user.allSites ? {} : { siteId: { in: user.siteIds } }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization
  if (!h?.startsWith('Bearer ')) throw new HttpError(401, 'Authentication required', 'UNAUTHENTICATED')
  let sub: string
  try {
    sub = (jwt.verify(h.slice(7), JWT_SECRET) as { sub: string }).sub
  } catch {
    throw new HttpError(401, 'Invalid or expired session', 'UNAUTHENTICATED')
  }
  const u = await prisma.user.findUnique({ where: { id: sub }, include: { sites: true } })
  if (!u || !u.active) throw new HttpError(401, 'Account disabled or not found', 'UNAUTHENTICATED')
  req.user = {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    siteIds: u.sites.map((s) => s.siteId),
    allSites: ALL_SITE_ROLES.includes(u.role),
  }
  next()
}

// Very small in-memory brute-force limiter (per email+ip).
const attempts = new Map<string, { n: number; first: number }>()
const WINDOW = 15 * 60 * 1000
const MAX_FAILS = Number(process.env.LOGIN_MAX_FAILS ?? 10)

export const authRouter = Router()

authRouter.post('/login', async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body)
  const key = `${email.toLowerCase()}|${req.ip}`
  const a = attempts.get(key)
  if (a && Date.now() - a.first < WINDOW && a.n >= MAX_FAILS)
    throw new HttpError(429, 'Too many failed attempts. Try again later.', 'RATE_LIMITED')

  const u = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { sites: true } })
  const ok = u && u.active && (await bcrypt.compare(password, u.passwordHash))
  if (!ok) {
    const cur = a && Date.now() - a.first < WINDOW ? a : { n: 0, first: Date.now() }
    cur.n++
    attempts.set(key, cur)
    throw new HttpError(401, 'Invalid email or password', 'BAD_CREDENTIALS')
  }
  attempts.delete(key)
  const token = jwt.sign({ sub: u.id }, JWT_SECRET, { expiresIn: '12h' })
  await audit(prisma, u.id, 'LOGIN', 'User', u.id, null)
  res.json({
    token,
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      siteIds: u.sites.map((s) => s.siteId),
      allSites: ALL_SITE_ROLES.includes(u.role),
    },
  })
})

authRouter.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user, permissions: Object.entries(PERMS).filter(([, r]) => (r as readonly Role[]).includes(req.user!.role)).map(([k]) => k) })
})
