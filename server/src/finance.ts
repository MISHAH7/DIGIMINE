import { Router } from 'express'
import { z } from 'zod'
import { D, prisma } from './db.js'
import { assertSite, requirePerm, siteWhere } from './auth.js'
import { createApproval } from './approvals.js'
import { audit, conflict, DATE_RE, dateOnly, dayEnd, dayStart, dateRange, pageParams, parse, str, unprocessable } from './lib.js'
import { checkEventTime, clientIdField, idempotent } from './operations.js'

export const financeRouter = Router()

// ---- Expenses / purchases (FR-019) -------------------------------------------------------
financeRouter.post('/expenses', requirePerm('expense.create'), async (req, res) => {
  const user = req.user!
  const b = parse(
    z.object({
      siteId: z.string().min(1),
      category: z.string().min(2).max(60),
      description: z.string().max(300).optional(),
      supplierId: z.string().optional(),
      amount: z.coerce.number().positive().max(1_000_000_000),
      method: z.enum(['CASH', 'MPESA']),
      paymentRef: z.string().max(60).optional(),
      spentAt: z.coerce.date().optional(),
      clientId: clientIdField,
    }),
    req.body,
  )
  assertSite(user, b.siteId)
  const when = checkEventTime(b.spentAt, user.role)
  const { row, duplicate } = await idempotent(
    b.clientId,
    (clientId) => prisma.expense.findUnique({ where: { clientId } }),
    () =>
      prisma.$transaction(async (tx) => {
        const e = await tx.expense.create({
          data: { clientId: b.clientId, siteId: b.siteId, category: b.category, description: b.description, supplierId: b.supplierId, amount: D(b.amount), method: b.method, paymentRef: b.paymentRef, spentAt: when, recordedById: user.id },
        })
        await createApproval(tx, { type: 'EXPENSE', entityId: e.id, siteId: b.siteId, amount: b.amount, summary: `Expense: ${b.category} KES ${b.amount} (${b.method})`, requestedById: user.id })
        await audit(tx, user.id, 'CREATE', 'Expense', e.id, b.siteId, { category: b.category, amount: b.amount })
        return e
      }),
  )
  res.status(duplicate ? 200 : 201).json({ ...row, duplicate })
})

financeRouter.get('/expenses', requirePerm('business.read'), async (req, res) => {
  const { take, skip } = pageParams(req.query)
  const status = str(req.query.status)
  res.json(
    await prisma.expense.findMany({
      where: { ...siteWhere(req.user!, str(req.query.siteId)), ...(status ? { status: status as 'PENDING' } : {}), spentAt: dateRange(str(req.query.from), str(req.query.to)) },
      orderBy: { spentAt: 'desc' },
      take,
      skip,
    }),
  )
})

// ---- Cashbook (FR-020) ---------------------------------------------------------------------
financeRouter.get('/cash/entries', requirePerm('business.read'), async (req, res) => {
  const { take, skip } = pageParams(req.query)
  const method = str(req.query.method)
  res.json(
    await prisma.cashEntry.findMany({
      where: { ...siteWhere(req.user!, str(req.query.siteId)), ...(method ? { method: method as 'CASH' } : {}), occurredAt: dateRange(str(req.query.from), str(req.query.to)) },
      orderBy: { occurredAt: 'desc' },
      take,
      skip,
    }),
  )
})

/** Manual entries (float top-ups, other income/expenses). Sales and payouts post automatically from source records. */
financeRouter.post('/cash/entries', requirePerm('cash.write'), async (req, res) => {
  const user = req.user!
  const b = parse(
    z.object({
      siteId: z.string().min(1),
      direction: z.enum(['IN', 'OUT']),
      category: z.string().min(2).max(60),
      amount: z.coerce.number().positive().max(1_000_000_000),
      method: z.enum(['CASH', 'MPESA']),
      reference: z.string().max(60).optional(),
      note: z.string().min(3, 'A note is required for manual entries').max(300),
      occurredAt: z.coerce.date().optional(),
    }),
    req.body,
  )
  assertSite(user, b.siteId)
  const when = checkEventTime(b.occurredAt, user.role)
  const e = await prisma.$transaction(async (tx) => {
    const c = await tx.cashEntry.create({
      data: { siteId: b.siteId, direction: b.direction, category: b.category, amount: D(b.amount), method: b.method, reference: b.reference, sourceType: 'Manual', note: b.note, occurredAt: when, recordedById: user.id },
    })
    await audit(tx, user.id, 'CREATE', 'CashEntry', c.id, b.siteId, b)
    return c
  })
  res.status(201).json(e)
})

/** Expected closing position for a site/day, derived from source transactions (FR-023, BR-007). */
export async function cashPosition(siteId: string, date: string) {
  const start = dayStart(date)
  const end = dayEnd(date)
  const sum = async (where: object) => {
    const [i, o] = await Promise.all([
      prisma.cashEntry.aggregate({ where: { siteId, direction: 'IN', ...where }, _sum: { amount: true } }),
      prisma.cashEntry.aggregate({ where: { siteId, direction: 'OUT', ...where }, _sum: { amount: true } }),
    ])
    return { in: i._sum.amount ?? D(0), out: o._sum.amount ?? D(0) }
  }
  const [cashBefore, cashDay, mpesaDay] = await Promise.all([
    sum({ method: 'CASH', occurredAt: { lt: start } }),
    sum({ method: 'CASH', occurredAt: { gte: start, lt: end } }),
    sum({ method: 'MPESA', occurredAt: { gte: start, lt: end } }),
  ])
  const openingCash = cashBefore.in.sub(cashBefore.out)
  return {
    siteId,
    businessDate: date,
    openingCash,
    cashIn: cashDay.in,
    cashOut: cashDay.out,
    expectedCash: openingCash.add(cashDay.in).sub(cashDay.out),
    mpesaIn: mpesaDay.in,
    mpesaOut: mpesaDay.out,
    mpesaExpected: mpesaDay.in.sub(mpesaDay.out),
  }
}

financeRouter.get('/cash/summary', requirePerm('business.read'), async (req, res) => {
  const siteId = str(req.query.siteId)
  const date = str(req.query.date)
  if (!siteId || !date || !DATE_RE.test(date)) throw unprocessable('siteId and date (YYYY-MM-DD) are required')
  assertSite(req.user!, siteId)
  const [pos, close] = await Promise.all([
    cashPosition(siteId, date),
    prisma.shiftClose.findUnique({ where: { siteId_businessDate: { siteId, businessDate: dateOnly(date) } } }),
  ])
  res.json({ ...pos, shiftClose: close })
})

// ---- Shift close & reconciliation (FR-021, FR-022, AC-007) ------------------------------------
financeRouter.post('/cash/shift-close', requirePerm('cash.write'), async (req, res) => {
  const user = req.user!
  const b = parse(
    z.object({
      siteId: z.string().min(1),
      businessDate: z.string().regex(DATE_RE),
      countedCash: z.coerce.number().nonnegative(),
      mpesaCounted: z.coerce.number().nonnegative(),
      explanation: z.string().max(500).optional(),
    }),
    req.body,
  )
  assertSite(user, b.siteId)
  const pos = await cashPosition(b.siteId, b.businessDate)
  const cashVariance = D(b.countedCash).sub(pos.expectedCash)
  const mpesaVariance = D(b.mpesaCounted).sub(pos.mpesaExpected)
  if (!(cashVariance.isZero() && mpesaVariance.isZero()) && !b.explanation?.trim())
    throw unprocessable(`Counted amounts differ from expected (cash ${cashVariance}, M-Pesa ${mpesaVariance}). An explanation is required.`, 'VARIANCE_EXPLANATION_REQUIRED')

  const businessDate = dateOnly(b.businessDate)
  const out = await prisma.$transaction(async (tx) => {
    const existing = await tx.shiftClose.findUnique({ where: { siteId_businessDate: { siteId: b.siteId, businessDate } } })
    if (existing && existing.status !== 'REJECTED') throw conflict('This shift/day has already been closed', 'ALREADY_CLOSED')
    const data = {
      openingCash: pos.openingCash,
      expectedCash: pos.expectedCash,
      countedCash: D(b.countedCash),
      cashVariance,
      mpesaExpected: pos.mpesaExpected,
      mpesaCounted: D(b.mpesaCounted),
      mpesaVariance,
      explanation: b.explanation,
      status: 'PENDING' as const,
      closedById: user.id,
    }
    const close = existing
      ? await tx.shiftClose.update({ where: { id: existing.id }, data })
      : await tx.shiftClose.create({ data: { siteId: b.siteId, businessDate, ...data } })
    const approval = await createApproval(tx, {
      type: 'SHIFT_CLOSE',
      entityId: close.id,
      siteId: b.siteId,
      summary: `Close ${b.businessDate}: cash variance ${cashVariance}, M-Pesa variance ${mpesaVariance}`,
      requestedById: user.id,
    })
    await audit(tx, user.id, 'SHIFT_CLOSE', 'ShiftClose', close.id, b.siteId, { cashVariance: cashVariance.toString(), mpesaVariance: mpesaVariance.toString() })
    return { close, approval }
  })
  res.status(201).json(out)
})

financeRouter.get('/cash/shift-closes', requirePerm('business.read'), async (req, res) => {
  const from = str(req.query.from)
  const to = str(req.query.to)
  res.json(
    await prisma.shiftClose.findMany({
      where: { ...siteWhere(req.user!, str(req.query.siteId)), ...(from || to ? { businessDate: { ...(from ? { gte: dateOnly(from) } : {}), ...(to ? { lte: dateOnly(to) } : {}) } } : {}) },
      orderBy: { businessDate: 'desc' },
      take: 200,
    }),
  )
})

