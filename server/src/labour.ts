import { Router } from 'express'
import { z } from 'zod'
import { D, prisma } from './db.js'
import { assertSite, requirePerm, siteWhere } from './auth.js'
import { createApproval } from './approvals.js'
import { audit, conflict, DATE_RE, dateOnly, dateRange, forbidden, nextRef, notFound, pageParams, parse, str, unprocessable } from './lib.js'
import { clientIdField, idempotent } from './operations.js'
import type { PayBasis } from './generated/prisma/enums.js'

export const labourRouter = Router()

/** Pick the approved rate in force on `workDate`: task-specific > site-specific > global; newest effective date wins (BR-005, FR-013). */
export async function findRate(basis: PayBasis, task: string | undefined, siteId: string, workDate: Date) {
  const rules = await prisma.rateRule.findMany({
    where: {
      basis,
      effectiveFrom: { lte: workDate },
      AND: [{ OR: [{ siteId: null }, { siteId }] }, task ? { OR: [{ task: null }, { task }] } : { task: null }],
    },
  })
  rules.sort(
    (a, b) =>
      (b.task ? 2 : 0) + (b.siteId ? 1 : 0) - ((a.task ? 2 : 0) + (a.siteId ? 1 : 0)) ||
      b.effectiveFrom.getTime() - a.effectiveFrom.getTime() ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  )
  return rules[0] ?? null
}

const workSchema = z.object({
  siteId: z.string().min(1),
  workerId: z.string().min(1),
  workDate: z.string().regex(DATE_RE),
  basis: z.enum(['PER_SACK', 'PER_SHIFT', 'PER_DAY', 'PER_HOUR', 'PER_TASK']),
  task: z.string().max(80).optional(),
  quantity: z.coerce.number().positive().max(100000),
  clientId: clientIdField,
})

labourRouter.post('/work-records', requirePerm('work.create'), async (req, res) => {
  const user = req.user!
  const b = parse(workSchema, req.body)
  assertSite(user, b.siteId)
  if (b.basis === 'PER_TASK' && !b.task) throw unprocessable('A task name is required for per-task pay', 'TASK_REQUIRED')
  const workDate = dateOnly(b.workDate)
  if (workDate.getTime() > Date.now() + 24 * 3600 * 1000) throw unprocessable('Work date cannot be in the future', 'FUTURE_DATE')

  const { row, duplicate } = await idempotent(
    b.clientId,
    (clientId) => prisma.workRecord.findUnique({ where: { clientId } }),
    async () => {
      const worker = await prisma.worker.findUnique({ where: { id: b.workerId } })
      if (!worker || !worker.active) throw unprocessable('Unknown or inactive worker', 'BAD_WORKER')
      const rule = await findRate(b.basis, b.task, b.siteId, workDate)
      if (!rule) throw unprocessable(`No approved ${b.basis} rate is in effect for ${b.workDate}. Ask a manager to set one.`, 'NO_RATE')
      const expected = D(b.quantity).mul(rule.rate).toDecimalPlaces(2)
      return prisma.$transaction(async (tx) => {
        const w = await tx.workRecord.create({
          data: {
            clientId: b.clientId,
            siteId: b.siteId,
            workerId: b.workerId,
            workDate,
            basis: b.basis,
            task: b.task,
            quantity: D(b.quantity),
            rate: rule.rate,
            expectedAmount: expected,
            rateRuleId: rule.id,
            recordedById: user.id,
          },
        })
        await audit(tx, user.id, 'CREATE', 'WorkRecord', w.id, b.siteId, { worker: b.workerId, basis: b.basis, quantity: b.quantity, rate: rule.rate.toString(), expected: expected.toString() })
        return w
      })
    },
  )
  res.status(duplicate ? 200 : 201).json({
    ...row,
    duplicate,
    breakdown: { basis: row.basis, quantity: row.quantity, rate: row.rate, expectedAmount: row.expectedAmount, formula: `${row.quantity} × ${row.rate} = ${row.expectedAmount}` },
  })
})

labourRouter.get('/work-records', requirePerm('business.read'), async (req, res) => {
  const { take, skip } = pageParams(req.query)
  const from = str(req.query.from)
  const to = str(req.query.to)
  const rows = await prisma.workRecord.findMany({
    where: {
      ...siteWhere(req.user!, str(req.query.siteId)),
      ...(str(req.query.workerId) ? { workerId: str(req.query.workerId) } : {}),
      ...(str(req.query.unpaid) ? { payoutId: null } : {}),
      ...(str(req.query.verified) === '1' ? { verifiedAt: { not: null } } : {}),
      ...(from || to ? { workDate: { ...(from ? { gte: dateOnly(from) } : {}), ...(to ? { lte: dateOnly(to) } : {}) } } : {}),
    },
    orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }],
    take,
    skip,
  })
  res.json(rows)
})

/** Supervisor verification; the verifier must differ from the recorder (BR-008). */
labourRouter.post('/work-records/:id/verify', requirePerm('work.verify'), async (req, res) => {
  const user = req.user!
  const id = String(req.params.id)
  const w = await prisma.workRecord.findUnique({ where: { id } })
  if (!w) throw notFound('Work record not found')
  assertSite(user, w.siteId)
  if (w.verifiedAt) throw conflict('Already verified', 'ALREADY_VERIFIED')
  if (w.recordedById === user.id) throw forbidden('You cannot verify a work record you entered', 'SELF_APPROVAL')
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.workRecord.update({ where: { id }, data: { verifiedById: user.id, verifiedAt: new Date() } })
    await audit(tx, user.id, 'VERIFY', 'WorkRecord', id, w.siteId)
    return u
  })
  res.json(updated)
})

// ---- Payouts (FR-014, FR-015, BR-006) ---------------------------------------------------
const payoutSchema = z.object({
  siteId: z.string().min(1),
  workerId: z.string().min(1),
  workRecordIds: z.array(z.string().min(1)).min(1),
  amountPaid: z.coerce.number().nonnegative().optional(),
  method: z.enum(['CASH', 'MPESA']),
  paymentRef: z.string().max(60).optional(),
  paidAt: z.coerce.date().optional(),
  shortfallNote: z.string().max(300).optional(),
  clientId: clientIdField,
})

labourRouter.post('/payouts', requirePerm('payout.create'), async (req, res) => {
  const user = req.user!
  const b = parse(payoutSchema, req.body)
  assertSite(user, b.siteId)
  const ids = [...new Set(b.workRecordIds)]

  const { row, duplicate } = await idempotent(
    b.clientId,
    (clientId) => prisma.payout.findUnique({ where: { clientId } }),
    async () => {
      const site = await prisma.site.findUnique({ where: { id: b.siteId } })
      if (!site) throw unprocessable('Unknown site', 'BAD_SITE')
      if (b.method === 'MPESA' && b.paymentRef) {
        const dup = await prisma.payout.findFirst({ where: { method: 'MPESA', paymentRef: b.paymentRef, status: { not: 'REJECTED' } } })
        if (dup) throw conflict(`M-Pesa reference ${b.paymentRef} was already used on payout ${dup.ref}`, 'DUPLICATE_PAYMENT_REF')
      }
      return prisma.$transaction(async (tx) => {
        const records = await tx.workRecord.findMany({ where: { id: { in: ids } } })
        if (records.length !== ids.length) throw unprocessable('Some work records were not found', 'BAD_WORK')
        for (const r of records) {
          if (r.workerId !== b.workerId || r.siteId !== b.siteId) throw unprocessable('Work records must belong to the selected worker and site', 'BAD_WORK')
          if (!r.verifiedAt) throw unprocessable('All work must be verified by a supervisor before payout', 'UNVERIFIED_WORK')
          if (r.payoutId) throw conflict('Some work has already been included in a payout', 'ALREADY_PAID')
        }
        const expected = records.reduce((s, r) => s.add(r.expectedAmount), D(0))
        const paid = b.amountPaid === undefined ? expected : D(b.amountPaid)
        if (paid.gt(expected)) throw unprocessable('Amount paid cannot exceed the calculated amount due', 'OVERPAYMENT')
        if (!paid.eq(expected) && !b.shortfallNote?.trim()) throw unprocessable('Explain why the amount paid differs from the amount due', 'SHORTFALL_NOTE_REQUIRED')

        const ref = await nextRef(tx, 'PAY', site.code)
        const payout = await tx.payout.create({
          data: { ref, clientId: b.clientId, siteId: b.siteId, workerId: b.workerId, expectedAmount: expected, amountPaid: paid, method: b.method, paymentRef: b.paymentRef, paidAt: b.paidAt ?? new Date(), shortfallNote: b.shortfallNote, recordedById: user.id },
        })
        // Atomic claim: if a concurrent request already took any record, count mismatches and we abort.
        const claimed = await tx.workRecord.updateMany({ where: { id: { in: ids }, payoutId: null }, data: { payoutId: payout.id } })
        if (claimed.count !== ids.length) throw conflict('Some work has already been included in a payout', 'ALREADY_PAID')
        await createApproval(tx, {
          type: 'PAYOUT',
          entityId: payout.id,
          siteId: b.siteId,
          amount: paid.toString(),
          summary: `Payout ${ref}: KES ${paid} via ${b.method} for ${records.length} work record(s)`,
          requestedById: user.id,
        })
        await audit(tx, user.id, 'CREATE', 'Payout', payout.id, b.siteId, { ref, expected: expected.toString(), paid: paid.toString(), method: b.method })
        return payout
      })
    },
  )
  res.status(duplicate ? 200 : 201).json({ ...row, duplicate })
})

labourRouter.get('/payouts', requirePerm('business.read'), async (req, res) => {
  const { take, skip } = pageParams(req.query)
  const status = str(req.query.status)
  res.json(
    await prisma.payout.findMany({
      where: {
        ...siteWhere(req.user!, str(req.query.siteId)),
        ...(str(req.query.workerId) ? { workerId: str(req.query.workerId) } : {}),
        ...(status ? { status: status as 'PENDING' } : {}),
        paidAt: dateRange(str(req.query.from), str(req.query.to)),
      },
      orderBy: { paidAt: 'desc' },
      take,
      skip,
    }),
  )
})

labourRouter.get('/payouts/:id', requirePerm('business.read'), async (req, res) => {
  const p = await prisma.payout.findUnique({ where: { id: String(req.params.id) } })
  if (!p) throw notFound('Payout not found')
  assertSite(req.user!, p.siteId)
  const items = await prisma.workRecord.findMany({ where: { payoutId: p.id }, orderBy: { workDate: 'asc' } })
  res.json({ ...p, items })
})
