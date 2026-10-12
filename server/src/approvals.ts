import { Router } from 'express'
import { z } from 'zod'
import { D, prisma, type Tx } from './db.js'
import { assertSite, requirePerm, siteWhere } from './auth.js'
import { audit, conflict, forbidden, notFound, parse, str, unprocessable, lockStock, stockBalance } from './lib.js'
import type { ApprovalType } from './generated/prisma/enums.js'

/** Amount (KES; sacks for STOCK_ADJUSTMENT) from which a second approver is required. Configurable via Setting. */
export const DEFAULT_THRESHOLDS: Record<ApprovalType, number> = {
  PAYOUT: 50000,
  EXPENSE: 50000,
  SALE_CANCEL: 100000,
  STOCK_ADJUSTMENT: 100,
  SHIFT_CLOSE: Number.MAX_SAFE_INTEGER,
}

export async function getThresholds(tx: Tx): Promise<Record<ApprovalType, number>> {
  const s = await tx.setting.findUnique({ where: { key: 'approvalThresholds' } })
  return { ...DEFAULT_THRESHOLDS, ...((s?.value as Partial<Record<ApprovalType, number>>) ?? {}) }
}

export async function createApproval(
  tx: Tx,
  a: { type: ApprovalType; entityId: string; siteId: string; amount?: number | string; magnitude?: number; summary: string; requestedById: string },
) {
  const th = await getThresholds(tx)
  const basis = a.magnitude ?? Number(a.amount ?? 0)
  const requiredSteps = basis >= th[a.type] ? 2 : 1
  const req = await tx.approvalRequest.create({
    data: {
      type: a.type,
      entityId: a.entityId,
      siteId: a.siteId,
      amount: a.amount === undefined ? undefined : D(a.amount),
      summary: a.summary,
      requiredSteps,
      requestedById: a.requestedById,
    },
  })
  await audit(tx, a.requestedById, 'APPROVAL_REQUESTED', 'ApprovalRequest', req.id, a.siteId, {
    type: a.type,
    entityId: a.entityId,
    requiredSteps,
  })
  return req
}

/** Apply (or undo) the business effect of an approval inside the deciding transaction. */
async function applyOutcome(tx: Tx, r: { type: ApprovalType; entityId: string; siteId: string }, approved: boolean, actorId: string) {
  switch (r.type) {
    case 'STOCK_ADJUSTMENT': {
      const adj = await tx.stockAdjustment.findUniqueOrThrow({ where: { id: r.entityId } })
      if (!approved) {
        await tx.stockAdjustment.update({ where: { id: adj.id }, data: { status: 'REJECTED' } })
        return
      }
      await lockStock(tx, adj.siteId, adj.materialId)
      if (adj.sacks < 0 && (await stockBalance(tx, adj.siteId, adj.materialId)) + adj.sacks < 0)
        throw conflict('Adjustment would make stock negative', 'INSUFFICIENT_STOCK')
      await tx.stockMovement.create({
        data: {
          siteId: adj.siteId,
          materialId: adj.materialId,
          type: adj.sacks > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
          sacks: adj.sacks,
          refType: 'StockAdjustment',
          refId: adj.id,
          note: adj.reason,
          createdById: actorId,
        },
      })
      await tx.stockAdjustment.update({ where: { id: adj.id }, data: { status: 'APPROVED' } })
      return
    }
    case 'PAYOUT': {
      const p = await tx.payout.findUniqueOrThrow({ where: { id: r.entityId } })
      if (!approved) {
        await tx.payout.update({ where: { id: p.id }, data: { status: 'REJECTED' } })
        await tx.workRecord.updateMany({ where: { payoutId: p.id }, data: { payoutId: null } }) // free the work to be paid correctly
        return
      }
      await tx.payout.update({ where: { id: p.id }, data: { status: 'APPROVED' } })
      await tx.cashEntry.create({
        data: {
          siteId: p.siteId,
          direction: 'OUT',
          category: 'WORKER_PAYOUT',
          amount: p.amountPaid,
          method: p.method,
          reference: p.paymentRef ?? p.ref,
          sourceType: 'Payout',
          sourceId: p.id,
          occurredAt: p.paidAt,
          recordedById: actorId,
        },
      })
      return
    }
    case 'SALE_CANCEL': {
      const s = await tx.sale.findUniqueOrThrow({ where: { id: r.entityId } })
      if (!approved) {
        await tx.sale.update({ where: { id: s.id }, data: { cancelReason: null, cancelledById: null } })
        return
      }
      await lockStock(tx, s.siteId, s.materialId)
      await tx.sale.update({ where: { id: s.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
      await tx.stockMovement.create({
        data: {
          siteId: s.siteId,
          materialId: s.materialId,
          type: 'SALE_REVERSAL',
          sacks: s.sacks,
          refType: 'Sale',
          refId: s.id,
          note: `Cancelled ${s.ref}: ${s.cancelReason ?? ''}`,
          createdById: actorId,
        },
      })
      await tx.cashEntry.create({
        data: {
          siteId: s.siteId,
          direction: 'OUT',
          category: 'SALE_REFUND',
          amount: s.total,
          method: s.method,
          reference: s.ref,
          sourceType: 'Sale',
          sourceId: s.id,
          note: `Reversal of ${s.ref}`,
          occurredAt: new Date(),
          recordedById: actorId,
        },
      })
      return
    }
    case 'EXPENSE': {
      const e = await tx.expense.findUniqueOrThrow({ where: { id: r.entityId } })
      if (!approved) {
        await tx.expense.update({ where: { id: e.id }, data: { status: 'REJECTED' } })
        return
      }
      await tx.expense.update({ where: { id: e.id }, data: { status: 'APPROVED' } })
      await tx.cashEntry.create({
        data: {
          siteId: e.siteId,
          direction: 'OUT',
          category: e.category,
          amount: e.amount,
          method: e.method,
          reference: e.paymentRef ?? undefined,
          sourceType: 'Expense',
          sourceId: e.id,
          note: e.description ?? undefined,
          occurredAt: e.spentAt,
          recordedById: actorId,
        },
      })
      return
    }
    case 'SHIFT_CLOSE': {
      await tx.shiftClose.update({ where: { id: r.entityId }, data: { status: approved ? 'APPROVED' : 'REJECTED' } })
      return
    }
  }
}

export const approvalsRouter = Router()

approvalsRouter.get('/', requirePerm('business.read'), async (req, res) => {
  const user = req.user!
  const status = str(req.query.status)
  const type = str(req.query.type)
  const rows = await prisma.approvalRequest.findMany({
    where: {
      ...siteWhere(user, str(req.query.siteId)),
      ...(status ? { status: status as 'PENDING' } : {}),
      ...(type ? { type: type as ApprovalType } : {}),
    },
    include: { decisions: { orderBy: { step: 'asc' } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  res.json(rows)
})

approvalsRouter.post('/:id/decide', requirePerm('approve'), async (req, res) => {
  const user = req.user!
  const id = String(req.params.id)
  const body = parse(z.object({ approved: z.boolean(), comment: z.string().max(500).optional() }), req.body)
  if (!body.approved && !body.comment?.trim()) throw unprocessable('A comment is required when rejecting', 'COMMENT_REQUIRED')

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ApprovalRequest" WHERE id = ${id} FOR UPDATE`
    const r = await tx.approvalRequest.findUnique({ where: { id }, include: { decisions: true } })
    if (!r) throw notFound('Approval request not found')
    assertSite(user, r.siteId)
    if (r.status !== 'PENDING') throw conflict('This request has already been decided', 'ALREADY_DECIDED')
    if (r.requestedById === user.id) throw forbidden('You cannot approve a record you requested', 'SELF_APPROVAL')
    if (r.decisions.some((d) => d.decidedById === user.id)) throw conflict('You have already reviewed this request', 'ALREADY_REVIEWED')

    const step = r.decisions.length + 1
    await tx.approvalDecision.create({
      data: { requestId: id, step, decidedById: user.id, approved: body.approved, comment: body.comment },
    })
    let status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING'
    if (!body.approved) status = 'REJECTED'
    else if (step >= r.requiredSteps) status = 'APPROVED'

    if (status !== 'PENDING') await applyOutcome(tx, r, status === 'APPROVED', user.id)
    const updated = await tx.approvalRequest.update({
      where: { id },
      data: { status, decidedAt: status === 'PENDING' ? null : new Date() },
      include: { decisions: { orderBy: { step: 'asc' } } },
    })
    await audit(tx, user.id, body.approved ? 'APPROVE' : 'REJECT', 'ApprovalRequest', id, r.siteId, {
      type: r.type,
      entityId: r.entityId,
      step,
      of: r.requiredSteps,
      comment: body.comment,
      resulting: status,
    })
    return updated
  })
  res.json(result)
})
