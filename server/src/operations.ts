import { Router } from 'express'
import { z } from 'zod'
import { D, prisma } from './db.js'
import { assertSite, requirePerm, siteWhere } from './auth.js'
import { createApproval } from './approvals.js'
import {
  audit,
  conflict,
  dateRange,
  isUniqueViolation,
  lockStock,
  nextRef,
  notFound,
  pageParams,
  parse,
  stockBalance,
  str,
  unprocessable,
} from './lib.js'
import type { Role } from './generated/prisma/enums.js'

const BACKDATE_DAYS = Number(process.env.BACKDATE_DAYS ?? 7)

/** BR-010: event time may not be in the future, and may only be backdated within a limit (managers exempt). */
export function checkEventTime(when: Date | undefined, role: Role): Date {
  const t = when ?? new Date()
  const now = Date.now()
  if (t.getTime() > now + 5 * 60 * 1000) throw unprocessable('Date/time cannot be in the future', 'FUTURE_DATE')
  if (role !== 'SITE_MANAGER' && now - t.getTime() > BACKDATE_DAYS * 24 * 3600 * 1000)
    throw unprocessable(`Records cannot be backdated more than ${BACKDATE_DAYS} days`, 'BACKDATED')
  return t
}

/** Date-only entries (no clock time): today counts as "now", other days are checked at midday East Africa Time. */
export function checkEventDate(entryDate: string, role: Role): Date {
  const todayEat = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10)
  if (entryDate === todayEat) return checkEventTime(undefined, role)
  return checkEventTime(new Date(`${entryDate}T${entryDate > todayEat ? '00' : '12'}:00:00+03:00`), role)
}

/** BR-011: retries with the same clientId return the original record instead of creating a duplicate. */
export async function idempotent<T>(
  clientId: string | undefined,
  find: (clientId: string) => Promise<T | null>,
  create: () => Promise<T>,
): Promise<{ row: T; duplicate: boolean }> {
  if (clientId) {
    const ex = await find(clientId)
    if (ex) return { row: ex, duplicate: true }
  }
  try {
    return { row: await create(), duplicate: false }
  } catch (e) {
    if (clientId && isUniqueViolation(e)) {
      const ex = await find(clientId)
      if (ex) return { row: ex, duplicate: true }
    }
    throw e
  }
}

export const clientIdField = z.string().min(8).max(100).optional()
const idField = z.string().min(1)

async function requireSiteAndMaterial(siteId: string, materialId: string) {
  const [site, material] = await Promise.all([
    prisma.site.findUnique({ where: { id: siteId } }),
    prisma.material.findUnique({ where: { id: materialId } }),
  ])
  if (!site || !site.active) throw unprocessable('Unknown or inactive site', 'BAD_SITE')
  if (!material || !material.active) throw unprocessable('Unknown or inactive material', 'BAD_MATERIAL')
  return { site, material }
}

export const opsRouter = Router()

// =====================================================================================
// Ore intake (FR-003) — creates exactly one RECEIPT ledger movement (AC-002)
// =====================================================================================
const intakeSchema = z.object({
  siteId: idField,
  materialId: idField,
  supplierId: idField.optional(),
  sacks: z.coerce.number().int().positive().max(1_000_000),
  notes: z.string().max(1000).optional(),
  receivedAt: z.coerce.date().optional(),
  clientId: clientIdField,
})

opsRouter.post('/intakes', requirePerm('intake.create'), async (req, res) => {
  const user = req.user!
  const b = parse(intakeSchema, req.body)
  assertSite(user, b.siteId)
  const when = checkEventTime(b.receivedAt, user.role)
  const { row, duplicate } = await idempotent(
    b.clientId,
    (clientId) => prisma.intake.findUnique({ where: { clientId } }),
    async () => {
      const { site } = await requireSiteAndMaterial(b.siteId, b.materialId)
      return prisma.$transaction(async (tx) => {
        await lockStock(tx, b.siteId, b.materialId)
        const ref = await nextRef(tx, 'INT', site.code)
        const intake = await tx.intake.create({
          data: { ref, clientId: b.clientId, siteId: b.siteId, materialId: b.materialId, supplierId: b.supplierId, sacks: b.sacks, notes: b.notes, receivedAt: when, recordedById: user.id },
        })
        await tx.stockMovement.create({
          data: { siteId: b.siteId, materialId: b.materialId, type: 'RECEIPT', sacks: b.sacks, refType: 'Intake', refId: intake.id, note: ref, createdById: user.id, occurredAt: when },
        })
        await audit(tx, user.id, 'CREATE', 'Intake', intake.id, b.siteId, { ref, sacks: b.sacks })
        return intake
      })
    },
  )
  res.status(duplicate ? 200 : 201).json({ ...row, duplicate })
})

opsRouter.get('/intakes', requirePerm('business.read'), async (req, res) => {
  const { take, skip } = pageParams(req.query)
  const q = str(req.query.q)
  const rows = await prisma.intake.findMany({
    where: {
      ...siteWhere(req.user!, str(req.query.siteId)),
      ...(str(req.query.materialId) ? { materialId: str(req.query.materialId) } : {}),
      receivedAt: dateRange(str(req.query.from), str(req.query.to)),
      ...(q ? { ref: { contains: q, mode: 'insensitive' as const } } : {}),
    },
    orderBy: { receivedAt: 'desc' },
    take,
    skip,
  })
  res.json(rows)
})

// =====================================================================================
// Inventory ledger (FR-005..007)
// =====================================================================================
opsRouter.get('/inventory/balances', requirePerm('business.read'), async (req, res) => {
  const g = await prisma.stockMovement.groupBy({
    by: ['siteId', 'materialId'],
    where: siteWhere(req.user!, str(req.query.siteId)),
    _sum: { sacks: true },
  })
  res.json(g.map((r) => ({ siteId: r.siteId, materialId: r.materialId, sacks: r._sum.sacks ?? 0 })))
})

/** AC-003: a balance explained by opening stock + the list of movements for a period. */
opsRouter.get('/inventory/ledger', requirePerm('business.read'), async (req, res) => {
  const siteId = str(req.query.siteId)
  const materialId = str(req.query.materialId)
  if (!siteId || !materialId) throw unprocessable('siteId and materialId are required')
  assertSite(req.user!, siteId)
  const range = dateRange(str(req.query.from), str(req.query.to))
  const before = range?.gte
    ? (await prisma.stockMovement.aggregate({ where: { siteId, materialId, occurredAt: { lt: range.gte } }, _sum: { sacks: true } }))._sum.sacks ?? 0
    : 0
  const movements = await prisma.stockMovement.findMany({
    where: { siteId, materialId, ...(range ? { occurredAt: range } : {}) },
    orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    take: 2000,
  })
  let running = before
  const lines = movements.map((m) => ({ ...m, balanceAfter: (running += m.sacks) }))
  res.json({ siteId, materialId, openingBalance: before, movements: lines, closingBalance: running })
})

opsRouter.post('/inventory/opening', requirePerm('stock.opening'), async (req, res) => {
  const user = req.user!
  const b = parse(z.object({ siteId: idField, materialId: idField, sacks: z.coerce.number().int().min(0) }), req.body)
  assertSite(user, b.siteId)
  await requireSiteAndMaterial(b.siteId, b.materialId)
  const mv = await prisma.$transaction(async (tx) => {
    await lockStock(tx, b.siteId, b.materialId)
    const existing = await tx.stockMovement.findFirst({ where: { siteId: b.siteId, materialId: b.materialId, type: 'OPENING' } })
    if (existing) throw conflict('Opening stock already set; use an approved adjustment instead', 'OPENING_EXISTS')
    const m = await tx.stockMovement.create({
      data: { siteId: b.siteId, materialId: b.materialId, type: 'OPENING', sacks: b.sacks, note: 'Opening stock', createdById: user.id },
    })
    await audit(tx, user.id, 'OPENING_STOCK', 'StockMovement', m.id, b.siteId, b)
    return m
  })
  res.status(201).json(mv)
})

opsRouter.post('/inventory/adjustments', requirePerm('stock.adjust'), async (req, res) => {
  const user = req.user!
  const b = parse(
    z.object({
      siteId: idField,
      materialId: idField,
      sacks: z.coerce.number().int().refine((n) => n !== 0, 'Adjustment cannot be zero'),
      reason: z.string().min(5, 'A reason is required').max(500),
      evidence: z.string().max(500).optional(),
    }),
    req.body,
  )
  assertSite(user, b.siteId)
  await requireSiteAndMaterial(b.siteId, b.materialId)
  const out = await prisma.$transaction(async (tx) => {
    const adj = await tx.stockAdjustment.create({ data: { ...b, createdById: user.id } })
    const approval = await createApproval(tx, {
      type: 'STOCK_ADJUSTMENT',
      entityId: adj.id,
      siteId: b.siteId,
      magnitude: Math.abs(b.sacks),
      summary: `Stock adjustment ${b.sacks > 0 ? '+' : ''}${b.sacks} sacks: ${b.reason}`,
      requestedById: user.id,
    })
    await audit(tx, user.id, 'CREATE', 'StockAdjustment', adj.id, b.siteId, b)
    return { adjustment: adj, approval }
  })
  res.status(201).json(out)
})

opsRouter.get('/inventory/adjustments', requirePerm('business.read'), async (req, res) => {
  res.json(await prisma.stockAdjustment.findMany({ where: siteWhere(req.user!, str(req.query.siteId)), orderBy: { createdAt: 'desc' }, take: 200 }))
})

// =====================================================================================
// Sales (FR-008..010) — cash/M-Pesa; total = qty × unit price (BR-004, AC-004)
// =====================================================================================
const saleSchema = z.object({
  siteId: idField,
  materialId: idField,
  buyerId: idField.optional(),
  buyerName: z.string().min(1).max(120).optional(),
  sacks: z.coerce.number().int().positive().max(1_000_000),
  unitPrice: z.coerce.number().nonnegative().max(100_000_000),
  method: z.enum(['CASH', 'MPESA']),
  paymentRef: z.string().max(60).optional(),
  soldAt: z.coerce.date().optional(),
  clientId: clientIdField,
})

opsRouter.post('/sales', requirePerm('sale.create'), async (req, res) => {
  const user = req.user!
  const b = parse(saleSchema, req.body)
  assertSite(user, b.siteId)
  const when = checkEventTime(b.soldAt, user.role)
  const { row, duplicate } = await idempotent(
    b.clientId,
    (clientId) => prisma.sale.findUnique({ where: { clientId } }),
    async () => {
      const { site } = await requireSiteAndMaterial(b.siteId, b.materialId)
      let buyerName = b.buyerName
      if (b.buyerId) {
        const buyer = await prisma.buyer.findUnique({ where: { id: b.buyerId } })
        if (!buyer) throw unprocessable('Unknown buyer', 'BAD_BUYER')
        buyerName = buyerName ?? buyer.name
      }
      if (!buyerName) buyerName = 'Walk-in buyer'
      if (b.method === 'MPESA' && b.paymentRef) {
        const dup = await prisma.sale.findFirst({ where: { method: 'MPESA', paymentRef: b.paymentRef, status: 'ACTIVE' } })
        if (dup) throw conflict(`M-Pesa reference ${b.paymentRef} is already recorded on sale ${dup.ref}`, 'DUPLICATE_PAYMENT_REF')
      }
      const total = D(b.unitPrice).mul(b.sacks).toDecimalPlaces(2)
      return prisma.$transaction(async (tx) => {
        await lockStock(tx, b.siteId, b.materialId)
        const available = await stockBalance(tx, b.siteId, b.materialId)
        if (available < b.sacks) throw conflict(`Insufficient stock: ${available} sacks available, ${b.sacks} requested`, 'INSUFFICIENT_STOCK')
        const ref = await nextRef(tx, 'SAL', site.code)
        const sale = await tx.sale.create({
          data: { ref, clientId: b.clientId, siteId: b.siteId, materialId: b.materialId, buyerId: b.buyerId, buyerName, sacks: b.sacks, unitPrice: D(b.unitPrice), total, method: b.method, paymentRef: b.paymentRef, soldAt: when, recordedById: user.id },
        })
        await tx.stockMovement.create({
          data: { siteId: b.siteId, materialId: b.materialId, type: 'SALE', sacks: -b.sacks, refType: 'Sale', refId: sale.id, note: ref, createdById: user.id, occurredAt: when },
        })
        await tx.cashEntry.create({
          data: { siteId: b.siteId, direction: 'IN', category: 'SALE', amount: total, method: b.method, reference: b.paymentRef ?? ref, sourceType: 'Sale', sourceId: sale.id, occurredAt: when, recordedById: user.id },
        })
        await audit(tx, user.id, 'CREATE', 'Sale', sale.id, b.siteId, { ref, sacks: b.sacks, total: total.toString() })
        return sale
      })
    },
  )
  res.status(duplicate ? 200 : 201).json({ ...row, duplicate })
})

opsRouter.get('/sales', requirePerm('business.read'), async (req, res) => {
  const { take, skip } = pageParams(req.query)
  const q = str(req.query.q)
  const status = str(req.query.status)
  const rows = await prisma.sale.findMany({
    where: {
      ...siteWhere(req.user!, str(req.query.siteId)),
      soldAt: dateRange(str(req.query.from), str(req.query.to)),
      ...(status ? { status: status as 'ACTIVE' | 'CANCELLED' } : {}),
      ...(q ? { OR: [{ ref: { contains: q, mode: 'insensitive' as const } }, { buyerName: { contains: q, mode: 'insensitive' as const } }] } : {}),
    },
    orderBy: { soldAt: 'desc' },
    take,
    skip,
  })
  res.json(rows)
})

/** Receipt data for printing / PDF (FR-009). */
opsRouter.get('/sales/:id/receipt', requirePerm('business.read'), async (req, res) => {
  const s = await prisma.sale.findUnique({ where: { id: String(req.params.id) } })
  if (!s) throw notFound('Sale not found')
  assertSite(req.user!, s.siteId)
  const [site, material, recorder] = await Promise.all([
    prisma.site.findUnique({ where: { id: s.siteId } }),
    prisma.material.findUnique({ where: { id: s.materialId } }),
    prisma.user.findUnique({ where: { id: s.recordedById }, select: { name: true } }),
  ])
  res.json({ sale: s, site, material, recordedBy: recorder?.name })
})

/** FR-010: cancellation is a request that needs approval; the original sale is preserved (BR-009). */
opsRouter.post('/sales/:id/cancel', requirePerm('sale.cancel'), async (req, res) => {
  const user = req.user!
  const { reason } = parse(z.object({ reason: z.string().min(5, 'A reason is required').max(500) }), req.body)
  const s = await prisma.sale.findUnique({ where: { id: String(req.params.id) } })
  if (!s) throw notFound('Sale not found')
  assertSite(user, s.siteId)
  if (s.status === 'CANCELLED') throw conflict('Sale is already cancelled', 'ALREADY_CANCELLED')
  const open = await prisma.approvalRequest.findFirst({ where: { type: 'SALE_CANCEL', entityId: s.id, status: 'PENDING' } })
  if (open) throw conflict('A cancellation request is already pending', 'ALREADY_PENDING')
  const approval = await prisma.$transaction(async (tx) => {
    await tx.sale.update({ where: { id: s.id }, data: { cancelReason: reason, cancelledById: user.id } })
    const a = await createApproval(tx, {
      type: 'SALE_CANCEL',
      entityId: s.id,
      siteId: s.siteId,
      amount: s.total.toString(),
      summary: `Cancel sale ${s.ref} (${s.sacks} sacks, KES ${s.total}): ${reason}`,
      requestedById: user.id,
    })
    await audit(tx, user.id, 'CANCEL_REQUEST', 'Sale', s.id, s.siteId, { reason })
    return a
  })
  res.status(202).json(approval)
})

