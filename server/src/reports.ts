import { Router } from 'express'
import { D, prisma } from './db.js'
import { requirePerm, siteWhere } from './auth.js'
import { audit, dateOnly, dateRange, str, unprocessable, DATE_RE } from './lib.js'

export const reportsRouter = Router()

const n = (d: { toString(): string } | null | undefined) => Number(d?.toString() ?? 0)

/** FR-026 / BR-012: all totals derive from source records. */
reportsRouter.get('/reports/summary', requirePerm('business.read'), async (req, res) => {
  const user = req.user!
  const from = str(req.query.from)
  const to = str(req.query.to)
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) throw unprocessable('Dates must be YYYY-MM-DD')
  const site = siteWhere(user, str(req.query.siteId))
  const ts = dateRange(from, to)
  const dateCol = from || to ? { gte: from ? dateOnly(from) : undefined, lte: to ? dateOnly(to) : undefined } : undefined

  const [intakeAgg, salesAgg, salesByMethod, cancelledAgg, work, payoutsAgg, pendingPayouts, fuelP, fuelI, expAgg, expByCat, cashIn, cashOut, balances, pending, salesBySite, intakeBySite] =
    await Promise.all([
      prisma.intake.aggregate({ where: { ...site, status: 'ACTIVE', receivedAt: ts }, _sum: { sacks: true }, _count: true }),
      prisma.sale.aggregate({ where: { ...site, status: 'ACTIVE', soldAt: ts }, _sum: { sacks: true, total: true }, _count: true }),
      prisma.sale.groupBy({ by: ['method'], where: { ...site, status: 'ACTIVE', soldAt: ts }, _sum: { total: true } }),
      prisma.sale.aggregate({ where: { ...site, status: 'CANCELLED', soldAt: ts }, _sum: { total: true }, _count: true }),
      prisma.workRecord.aggregate({ where: { ...site, workDate: dateCol }, _sum: { expectedAmount: true }, _count: true }),
      prisma.payout.aggregate({ where: { ...site, status: 'APPROVED', paidAt: ts }, _sum: { amountPaid: true, expectedAmount: true }, _count: true }),
      prisma.payout.aggregate({ where: { ...site, status: 'PENDING', paidAt: ts }, _sum: { amountPaid: true }, _count: true }),
      prisma.fuelEntry.aggregate({ where: { ...site, kind: 'PURCHASE', entryDate: dateCol }, _sum: { litres: true, cost: true } }),
      prisma.fuelEntry.aggregate({ where: { ...site, kind: 'ISSUE', entryDate: dateCol }, _sum: { litres: true } }),
      prisma.expense.aggregate({ where: { ...site, status: 'APPROVED', spentAt: ts }, _sum: { amount: true } }),
      prisma.expense.groupBy({ by: ['category'], where: { ...site, status: 'APPROVED', spentAt: ts }, _sum: { amount: true } }),
      prisma.cashEntry.groupBy({ by: ['method'], where: { ...site, direction: 'IN', occurredAt: ts }, _sum: { amount: true } }),
      prisma.cashEntry.groupBy({ by: ['method'], where: { ...site, direction: 'OUT', occurredAt: ts }, _sum: { amount: true } }),
      prisma.stockMovement.groupBy({ by: ['siteId', 'materialId'], where: site, _sum: { sacks: true } }),
      prisma.approvalRequest.count({ where: { ...site, status: 'PENDING' } }),
      prisma.sale.groupBy({ by: ['siteId'], where: { ...site, status: 'ACTIVE', soldAt: ts }, _sum: { sacks: true, total: true } }),
      prisma.intake.groupBy({ by: ['siteId'], where: { ...site, status: 'ACTIVE', receivedAt: ts }, _sum: { sacks: true } }),
    ])

  const revenue = D(salesAgg._sum.total ?? 0)
  const labourCost = D(payoutsAgg._sum.amountPaid ?? 0)
  const expenses = D(expAgg._sum.amount ?? 0)
  const fuelCost = D(fuelP._sum.cost ?? 0)
  const costs = labourCost.add(expenses).add(fuelCost)

  res.json({
    period: { from: from ?? null, to: to ?? null },
    intake: { count: intakeAgg._count, sacks: intakeAgg._sum.sacks ?? 0 },
    sales: {
      count: salesAgg._count,
      sacks: salesAgg._sum.sacks ?? 0,
      revenue: n(revenue),
      byMethod: Object.fromEntries(salesByMethod.map((r) => [r.method, n(r._sum.total)])),
      cancelled: { count: cancelledAgg._count, value: n(cancelledAgg._sum.total) },
    },
    labour: {
      workRecords: work._count,
      expected: n(work._sum.expectedAmount),
      paidApproved: n(payoutsAgg._sum.amountPaid),
      payoutsApproved: payoutsAgg._count,
      pendingPayouts: pendingPayouts._count,
      pendingPayoutAmount: n(pendingPayouts._sum.amountPaid),
    },
    fuel: { purchasedLitres: n(fuelP._sum.litres), purchaseCost: n(fuelCost), issuedLitres: n(fuelI._sum.litres) },
    expenses: { total: n(expenses), byCategory: Object.fromEntries(expByCat.map((r) => [r.category, n(r._sum.amount)])) },
    cash: {
      in: Object.fromEntries(cashIn.map((r) => [r.method, n(r._sum.amount)])),
      out: Object.fromEntries(cashOut.map((r) => [r.method, n(r._sum.amount)])),
    },
    stockOnHand: balances.map((b) => ({ siteId: b.siteId, materialId: b.materialId, sacks: b._sum.sacks ?? 0 })),
    bySite: {
      sales: salesBySite.map((r) => ({ siteId: r.siteId, sacks: r._sum.sacks ?? 0, revenue: n(r._sum.total) })),
      intake: intakeBySite.map((r) => ({ siteId: r.siteId, sacks: r._sum.sacks ?? 0 })),
    },
    margin: {
      revenue: n(revenue),
      costs: n(costs),
      indicativeMargin: n(revenue.sub(costs)),
      definition: 'Revenue = active sales. Costs = approved worker payouts + approved expenses + fuel purchase cost. Indicative operating margin only, not statutory profit (BR-012).',
    },
    pendingApprovals: pending,
  })
})

// ---- CSV export (FR-027) -------------------------------------------------------------------------
/** Escape CSV and neutralise spreadsheet formula injection. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s = v instanceof Date ? v.toISOString() : String(v)
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const toCsv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0]!)
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n'
}

reportsRouter.get('/reports/export', requirePerm('business.read'), async (req, res) => {
  const user = req.user!
  const type = str(req.query.type)
  const from = str(req.query.from)
  const to = str(req.query.to)
  const site = siteWhere(user, str(req.query.siteId))
  const ts = dateRange(from, to)
  const dateCol = from || to ? { gte: from ? dateOnly(from) : undefined, lte: to ? dateOnly(to) : undefined } : undefined
  let rows: Record<string, unknown>[]
  switch (type) {
    case 'sales':
      rows = (await prisma.sale.findMany({ where: { ...site, soldAt: ts }, orderBy: { soldAt: 'asc' }, take: 20000 })).map((s) => ({ reference: s.ref, soldAt: s.soldAt, siteId: s.siteId, buyer: s.buyerName, sacks: s.sacks, unitPrice: s.unitPrice, total: s.total, method: s.method, paymentRef: s.paymentRef, status: s.status }))
      break
    case 'intakes':
      rows = (await prisma.intake.findMany({ where: { ...site, receivedAt: ts }, orderBy: { receivedAt: 'asc' }, take: 20000 })).map((i) => ({ reference: i.ref, receivedAt: i.receivedAt, siteId: i.siteId, materialId: i.materialId, sacks: i.sacks, notes: i.notes, status: i.status }))
      break
    case 'payouts':
      rows = (await prisma.payout.findMany({ where: { ...site, paidAt: ts }, orderBy: { paidAt: 'asc' }, take: 20000 })).map((p) => ({ reference: p.ref, paidAt: p.paidAt, siteId: p.siteId, workerId: p.workerId, amountDue: p.expectedAmount, amountPaid: p.amountPaid, method: p.method, paymentRef: p.paymentRef, status: p.status, shortfallNote: p.shortfallNote }))
      break
    case 'cashbook':
      rows = (await prisma.cashEntry.findMany({ where: { ...site, occurredAt: ts }, orderBy: { occurredAt: 'asc' }, take: 20000 })).map((c) => ({ occurredAt: c.occurredAt, siteId: c.siteId, direction: c.direction, category: c.category, amount: c.amount, method: c.method, reference: c.reference, source: c.sourceType, note: c.note }))
      break
    case 'fuel':
      rows = (await prisma.fuelEntry.findMany({ where: { ...site, entryDate: dateCol }, orderBy: { entryDate: 'asc' }, take: 20000 })).map((f) => ({ date: f.entryDate.toISOString().slice(0, 10), siteId: f.siteId, kind: f.kind, category: f.category, litres: f.litres, cost: f.cost }))
      break
    case 'work':
      rows = (await prisma.workRecord.findMany({ where: { ...site, workDate: dateCol }, orderBy: { workDate: 'asc' }, take: 20000 })).map((w) => ({ date: w.workDate.toISOString().slice(0, 10), siteId: w.siteId, workerId: w.workerId, basis: w.basis, task: w.task, quantity: w.quantity, rate: w.rate, expectedAmount: w.expectedAmount, verified: !!w.verifiedAt, paid: !!w.payoutId }))
      break
    default:
      throw unprocessable('type must be one of sales, intakes, payouts, cashbook, fuel, work')
  }
  await audit(prisma, user.id, 'EXPORT', 'Report', null, str(req.query.siteId) ?? null, { type, from, to, rows: rows.length })
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="digimine-${type}-${from ?? 'all'}_${to ?? 'all'}.csv"`)
  res.send(toCsv(rows))
})
