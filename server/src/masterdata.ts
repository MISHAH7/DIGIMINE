import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { D, prisma } from './db.js'
import { can, requirePerm, siteWhere } from './auth.js'
import { audit, badRequest, conflict, DATE_RE, dateOnly, pageParams, parse, str } from './lib.js'
import { DEFAULT_THRESHOLDS } from './approvals.js'

export const masterRouter = Router()
const roleEnum = z.enum(['ADMIN', 'OWNER', 'SITE_MANAGER', 'CLERK', 'SUPERVISOR', 'FINANCE', 'SAFETY', 'AUDITOR'])

// ---- Sites ----------------------------------------------------------------------------
masterRouter.get('/sites', async (req, res) => {
  const u = req.user!
  const where = u.allSites || u.role === 'ADMIN' ? {} : { id: { in: u.siteIds } }
  res.json(await prisma.site.findMany({ where, orderBy: { name: 'asc' } }))
})
masterRouter.post('/sites', requirePerm('sites.manage'), async (req, res) => {
  const b = parse(z.object({ code: z.string().min(2).max(10).toUpperCase(), name: z.string().min(2) }), req.body)
  const site = await prisma.site.create({ data: b })
  await audit(prisma, req.user!.id, 'CREATE', 'Site', site.id, site.id, b)
  res.status(201).json(site)
})
masterRouter.patch('/sites/:id', requirePerm('sites.manage'), async (req, res) => {
  const b = parse(z.object({ name: z.string().min(2).optional(), active: z.boolean().optional() }), req.body)
  const site = await prisma.site.update({ where: { id: String(req.params.id) }, data: b })
  await audit(prisma, req.user!.id, 'UPDATE', 'Site', site.id, site.id, b)
  res.json(site)
})

// ---- Users (FR-001) ---------------------------------------------------------------------
const publicUser = (u: { id: string; name: string; email: string; role: string; active: boolean; sites: { siteId: string }[] }) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  active: u.active,
  siteIds: u.sites.map((s) => s.siteId),
})
masterRouter.get('/users', requirePerm('users.manage'), async (_req, res) => {
  const us = await prisma.user.findMany({ include: { sites: true }, orderBy: { name: 'asc' } })
  res.json(us.map(publicUser))
})
masterRouter.post('/users', requirePerm('users.manage'), async (req, res) => {
  const b = parse(
    z.object({
      name: z.string().min(2),
      email: z.string().email().transform((e) => e.toLowerCase()),
      password: z.string().min(8, 'Password must be at least 8 characters'),
      role: roleEnum,
      siteIds: z.array(z.string()).default([]),
    }),
    req.body,
  )
  const u = await prisma.user.create({
    data: {
      name: b.name,
      email: b.email,
      role: b.role,
      passwordHash: await bcrypt.hash(b.password, 10),
      sites: { create: b.siteIds.map((siteId) => ({ siteId })) },
    },
    include: { sites: true },
  })
  await audit(prisma, req.user!.id, 'USER_CREATE', 'User', u.id, null, { email: b.email, role: b.role, siteIds: b.siteIds })
  res.status(201).json(publicUser(u))
})
masterRouter.patch('/users/:id', requirePerm('users.manage'), async (req, res) => {
  const id = String(req.params.id)
  const b = parse(
    z.object({
      name: z.string().min(2).optional(),
      role: roleEnum.optional(),
      active: z.boolean().optional(),
      password: z.string().min(8).optional(),
      siteIds: z.array(z.string()).optional(),
    }),
    req.body,
  )
  if (id === req.user!.id && (b.active === false || (b.role && b.role !== req.user!.role)))
    throw conflict('You cannot disable or change the role of your own account', 'SELF_CHANGE')
  const u = await prisma.$transaction(async (tx) => {
    if (b.siteIds) {
      await tx.userSite.deleteMany({ where: { userId: id } })
      await tx.userSite.createMany({ data: b.siteIds.map((siteId) => ({ userId: id, siteId })) })
    }
    const updated = await tx.user.update({
      where: { id },
      data: {
        name: b.name,
        role: b.role,
        active: b.active,
        passwordHash: b.password ? await bcrypt.hash(b.password, 10) : undefined,
      },
      include: { sites: true },
    })
    await audit(tx, req.user!.id, 'USER_UPDATE', 'User', id, null, { ...b, password: b.password ? '***' : undefined })
    return updated
  })
  res.json(publicUser(u))
})

// ---- Simple reference lists --------------------------------------------------------------
masterRouter.get('/materials', async (_req, res) => res.json(await prisma.material.findMany({ orderBy: { name: 'asc' } })))
masterRouter.post('/materials', requirePerm('config.manage'), async (req, res) => {
  const b = parse(z.object({ name: z.string().min(2), sackKg: z.coerce.number().positive().optional() }), req.body)
  const m = await prisma.material.create({ data: { name: b.name, sackKg: b.sackKg === undefined ? undefined : D(b.sackKg) } })
  await audit(prisma, req.user!.id, 'CREATE', 'Material', m.id, null, b)
  res.status(201).json(m)
})
masterRouter.patch('/materials/:id', requirePerm('config.manage'), async (req, res) => {
  const b = parse(z.object({ name: z.string().min(2).optional(), active: z.boolean().optional() }), req.body)
  const m = await prisma.material.update({ where: { id: String(req.params.id) }, data: b })
  await audit(prisma, req.user!.id, 'UPDATE', 'Material', m.id, null, b)
  res.json(m)
})

for (const [path, model] of [
  ['suppliers', 'supplier'],
  ['buyers', 'buyer'],
] as const) {
  masterRouter.get(`/${path}`, requirePerm('business.read'), async (req, res) => {
    const q = str(req.query.q)
    const rows = await (prisma[model] as typeof prisma.supplier).findMany({
      where: q ? { name: { contains: q, mode: 'insensitive' } } : {},
      orderBy: { name: 'asc' },
      take: 500,
    })
    res.json(rows)
  })
  masterRouter.post(`/${path}`, requirePerm('sale.create'), async (req, res) => {
    const b = parse(z.object({ name: z.string().min(2), phone: z.string().optional(), notes: z.string().optional() }), req.body)
    const data = model === 'buyer' ? { name: b.name, phone: b.phone } : b
    const row = await (prisma[model] as typeof prisma.supplier).create({ data })
    await audit(prisma, req.user!.id, 'CREATE', model, row.id, null, b)
    res.status(201).json(row)
  })
}

// ---- Workers (FR-011) ---------------------------------------------------------------------
masterRouter.get('/workers', requirePerm('business.read'), async (req, res) => {
  const q = str(req.query.q)
  res.json(
    await prisma.worker.findMany({
      where: q ? { name: { contains: q, mode: 'insensitive' } } : {},
      orderBy: { name: 'asc' },
      take: 500,
    }),
  )
})
masterRouter.post('/workers', requirePerm('worker.manage'), async (req, res) => {
  const b = parse(z.object({ name: z.string().min(2), phone: z.string().optional() }), req.body)
  const w = await prisma.worker.create({ data: b })
  await audit(prisma, req.user!.id, 'CREATE', 'Worker', w.id, null, { name: b.name })
  res.status(201).json(w)
})
masterRouter.patch('/workers/:id', requirePerm('worker.manage'), async (req, res) => {
  const b = parse(z.object({ name: z.string().min(2).optional(), phone: z.string().optional(), active: z.boolean().optional() }), req.body)
  const w = await prisma.worker.update({ where: { id: String(req.params.id) }, data: b })
  await audit(prisma, req.user!.id, 'UPDATE', 'Worker', w.id, null, b)
  res.json(w)
})

// ---- Rates (FR-034): append-only history with effective dates -------------------------------
masterRouter.get('/rates', requirePerm('business.read'), async (_req, res) => {
  res.json(await prisma.rateRule.findMany({ orderBy: [{ basis: 'asc' }, { effectiveFrom: 'desc' }], take: 500 }))
})
masterRouter.post('/rates', requirePerm('rates.manage'), async (req, res) => {
  const b = parse(
    z.object({
      basis: z.enum(['PER_SACK', 'PER_SHIFT', 'PER_DAY', 'PER_HOUR', 'PER_TASK']),
      task: z.string().min(1).optional(),
      siteId: z.string().optional(),
      rate: z.coerce.number().positive(),
      effectiveFrom: z.string().regex(DATE_RE),
    }),
    req.body,
  )
  if (b.siteId) siteWhere(req.user!, b.siteId)
  const r = await prisma.rateRule.create({
    data: { ...b, rate: D(b.rate), effectiveFrom: dateOnly(b.effectiveFrom), createdById: req.user!.id },
  })
  await audit(prisma, req.user!.id, 'CREATE', 'RateRule', r.id, b.siteId ?? null, b)
  res.status(201).json(r)
})

// ---- Settings (approval thresholds etc.) ------------------------------------------------------
masterRouter.get('/settings/approvalThresholds', async (_req, res) => {
  const s = await prisma.setting.findUnique({ where: { key: 'approvalThresholds' } })
  res.json({ ...DEFAULT_THRESHOLDS, ...((s?.value as object) ?? {}) })
})
masterRouter.put('/settings/approvalThresholds', requirePerm('config.manage'), async (req, res) => {
  const num = z.coerce.number().positive()
  const b = parse(
    z.object({ PAYOUT: num, EXPENSE: num, SALE_CANCEL: num, STOCK_ADJUSTMENT: num }).partial(),
    req.body,
  )
  const cur = await prisma.setting.findUnique({ where: { key: 'approvalThresholds' } })
  const value = { ...((cur?.value as object) ?? {}), ...b }
  await prisma.setting.upsert({ where: { key: 'approvalThresholds' }, create: { key: 'approvalThresholds', value }, update: { value } })
  await audit(prisma, req.user!.id, 'SETTING_CHANGE', 'Setting', 'approvalThresholds', null, { before: cur?.value, after: value })
  res.json({ ...DEFAULT_THRESHOLDS, ...value })
})

// ---- Audit log read (FR-025) ----------------------------------------------------------------------
masterRouter.get('/audit', requirePerm('audit.read'), async (req, res) => {
  const { take, skip } = pageParams(req.query)
  const entity = str(req.query.entity)
  const entityId = str(req.query.entityId)
  const actorId = str(req.query.actorId)
  if (!can(req.user!.role, 'audit.read')) throw badRequest('Not allowed')
  const rows = await prisma.auditLog.findMany({
    where: { ...(entity ? { entity } : {}), ...(entityId ? { entityId } : {}), ...(actorId ? { actorId } : {}) },
    orderBy: { id: 'desc' },
    take,
    skip,
  })
  res.json(rows)
})
masterRouter.get('/audit/users', requirePerm('audit.read'), async (_req, res) => {
  const us = await prisma.user.findMany({ select: { id: true, name: true } })
  res.json(us)
})

