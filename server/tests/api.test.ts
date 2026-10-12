import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { createApp } from '../src/app.js'
import { prisma } from '../src/db.js'

const app = createApp()
const PW = 'TestPass123!'
const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10)

const TABLES = ['AuditLog','ApprovalDecision','ApprovalRequest','StockMovement','StockAdjustment','Sale','Intake','CashEntry','ShiftClose','Expense','FuelEntry','MaintenanceEvent','Equipment','WorkRecord','Payout','RateRule','Worker','Supplier','Buyer','Material','SafetyRecord','Setting','Counter','UserSite','User','Site']

const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` })
const get = (who: string, url: string) => request(app).get(url).set(as(who))
const post = (who: string, url: string, body: object = {}) => request(app).post(url).set(as(who)).send(body)
const patch = (who: string, url: string, body: object = {}) => request(app).patch(url).set(as(who)).send(body)

async function login(email: string) {
  const r = await request(app).post('/api/auth/login').send({ email, password: PW })
  expect(r.status).toBe(200)
  return r.body.token as string
}

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(',')} RESTART IDENTITY CASCADE`)
  const hash = await bcrypt.hash(PW, 4)
  await prisma.user.create({ data: { name: 'Admin', email: 'admin@t.local', passwordHash: hash, role: 'ADMIN' } })
  tokens.admin = await login('admin@t.local')

  const siteA = (await post('admin', '/api/sites', { code: 'AAA', name: 'Site A' })).body
  const siteB = (await post('admin', '/api/sites', { code: 'BBB', name: 'Site B' })).body
  ids.A = siteA.id
  ids.B = siteB.id
  const mk = async (key: string, role: string, siteIds: string[]) => {
    const r = await post('admin', '/api/users', { name: key, email: `${key}@t.local`, password: PW, role, siteIds })
    expect(r.status).toBe(201)
    ids[key] = r.body.id
    tokens[key] = await login(`${key}@t.local`)
  }
  await mk('owner', 'OWNER', [])
  await mk('manager', 'SITE_MANAGER', [ids.A, ids.B])
  await mk('manager2', 'SITE_MANAGER', [ids.A])
  await mk('clerkA', 'CLERK', [ids.A])
  await mk('clerkB', 'CLERK', [ids.B])
  await mk('supervisor', 'SUPERVISOR', [ids.A])
  await mk('finance', 'FINANCE', [ids.A, ids.B])
  await mk('safety', 'SAFETY', [ids.A])
  await mk('auditor', 'AUDITOR', [])

  ids.mat = (await post('admin', '/api/materials', { name: 'Ore 50kg', sackKg: 50 })).body.id
  await post('owner', '/api/rates', { basis: 'PER_SACK', rate: 40, effectiveFrom: '2026-01-01' })
  await post('owner', '/api/rates', { basis: 'PER_DAY', rate: 700, effectiveFrom: '2026-01-01' })
  ids.worker = (await post('supervisor', '/api/workers', { name: 'John Mwangi' })).body.id
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('authentication & access control', () => {
  it('rejects bad credentials and missing tokens', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: 'admin@t.local', password: 'wrong-pass' })).status).toBe(401)
    expect((await request(app).get('/api/intakes')).status).toBe(401)
  })

  it('AC-001: a Site A employee cannot read or write Site B records', async () => {
    const w = await post('clerkA', '/api/intakes', { siteId: ids.B, materialId: ids.mat, sacks: 5 })
    expect(w.status).toBe(403)
    expect((await get('clerkA', `/api/intakes?siteId=${ids.B}`)).status).toBe(403)
    expect((await get('clerkA', `/api/sites`)).body.map((s: { id: string }) => s.id)).toEqual([ids.A])
  })

  it('role limits are enforced server-side', async () => {
    expect((await post('auditor', '/api/intakes', { siteId: ids.A, materialId: ids.mat, sacks: 5 })).status).toBe(403)
    expect((await post('admin', '/api/intakes', { siteId: ids.A, materialId: ids.mat, sacks: 5 })).status).toBe(403)
    expect((await get('clerkA', '/api/audit')).status).toBe(403)
    expect((await get('admin', '/api/intakes')).status).toBe(403) // admin manages system, not business data
  })
})

describe('ore intake & inventory ledger', () => {
  it('AC-002/AC-003: intake gets a reference and posts exactly one ledger movement; balance is explained by movements', async () => {
    const r = await post('clerkA', '/api/intakes', { siteId: ids.A, materialId: ids.mat, sacks: 100, notes: 'first load' })
    expect(r.status).toBe(201)
    expect(r.body.ref).toMatch(/^INT-AAA-\d{6}$/)
    const ledger = (await get('clerkA', `/api/inventory/ledger?siteId=${ids.A}&materialId=${ids.mat}`)).body
    expect(ledger.movements).toHaveLength(1)
    expect(ledger.movements[0]).toMatchObject({ type: 'RECEIPT', sacks: 100, balanceAfter: 100 })
    expect(ledger.closingBalance).toBe(100)
  })

  it('AC-011/BR-011: retrying with the same clientId does not duplicate the intake or stock', async () => {
    const body = { siteId: ids.A, materialId: ids.mat, sacks: 20, clientId: 'offline-uuid-0001' }
    const a = await post('clerkA', '/api/intakes', body)
    const b = await post('clerkA', '/api/intakes', body)
    const c = await Promise.all([post('clerkA', '/api/intakes', body), post('clerkA', '/api/intakes', body)])
    expect(a.status).toBe(201)
    expect(b.status).toBe(200)
    expect(b.body.duplicate).toBe(true)
    expect(c.every((x) => x.body.id === a.body.id)).toBe(true)
    const bal = (await get('clerkA', `/api/inventory/balances?siteId=${ids.A}`)).body[0]
    expect(bal.sacks).toBe(120)
  })

  it('rejects future-dated and non-positive entries', async () => {
    const future = new Date(Date.now() + 3 * 86400e3).toISOString()
    expect((await post('clerkA', '/api/intakes', { siteId: ids.A, materialId: ids.mat, sacks: 5, receivedAt: future })).status).toBe(422)
    expect((await post('clerkA', '/api/intakes', { siteId: ids.A, materialId: ids.mat, sacks: 0 })).status).toBe(400)
  })

  it('opening stock can be set once; later corrections need an approved adjustment', async () => {
    expect((await post('manager', '/api/inventory/opening', { siteId: ids.B, materialId: ids.mat, sacks: 30 })).status).toBe(201)
    expect((await post('manager', '/api/inventory/opening', { siteId: ids.B, materialId: ids.mat, sacks: 40 })).status).toBe(409)
  })

  it('FR-007: adjustments are held until approved by someone else, then post to the ledger', async () => {
    const r = await post('supervisor', '/api/inventory/adjustments', { siteId: ids.A, materialId: ids.mat, sacks: -4, reason: 'Spillage during loading' })
    expect(r.status).toBe(201)
    const before = (await get('clerkA', `/api/inventory/balances?siteId=${ids.A}`)).body[0].sacks
    expect(before).toBe(120)
    expect((await post('supervisor', `/api/approvals/${r.body.approval.id}/decide`, { approved: true })).status).toBe(403) // not an approver role
    const ok = await post('manager2', `/api/approvals/${r.body.approval.id}/decide`, { approved: true })
    expect(ok.status).toBe(200)
    expect(ok.body.status).toBe('APPROVED')
    expect((await get('clerkA', `/api/inventory/balances?siteId=${ids.A}`)).body[0].sacks).toBe(116)
  })

  it('the stock ledger and audit log are append-only at database level (BR-009, NFR-004)', async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE "StockMovement" SET sacks = 999`)).rejects.toThrow(/append-only/)
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "AuditLog"`)).rejects.toThrow(/append-only/)
  })
})

describe('sales', () => {
  let saleId = ''
  it('AC-004: total = quantity × unit price, stock reduces, cash receipt posts', async () => {
    const r = await post('clerkA', '/api/sales', { siteId: ids.A, materialId: ids.mat, buyerName: 'Acme Traders', sacks: 10, unitPrice: 1500.5, method: 'CASH' })
    expect(r.status).toBe(201)
    expect(r.body.ref).toMatch(/^SAL-AAA-/)
    expect(Number(r.body.total)).toBe(15005)
    saleId = r.body.id
    expect((await get('clerkA', `/api/inventory/balances?siteId=${ids.A}`)).body[0].sacks).toBe(106)
    const cash = (await get('finance', `/api/cash/entries?siteId=${ids.A}`)).body
    expect(cash.find((c: { sourceId: string }) => c.sourceId === saleId)).toMatchObject({ direction: 'IN', method: 'CASH', category: 'SALE' })
    const receipt = await get('clerkA', `/api/sales/${saleId}/receipt`)
    expect(receipt.body.site.code).toBe('AAA')
  })

  it('cannot sell more than is in stock; concurrent sales cannot oversell', async () => {
    expect((await post('clerkA', '/api/sales', { siteId: ids.A, materialId: ids.mat, sacks: 107, unitPrice: 10, method: 'CASH' })).body.code).toBe('INSUFFICIENT_STOCK')
    const rs = await Promise.all([1, 2, 3].map(() => post('clerkA', '/api/sales', { siteId: ids.A, materialId: ids.mat, sacks: 40, unitPrice: 10, method: 'CASH' })))
    const okCount = rs.filter((r) => r.status === 201).length
    expect(okCount).toBe(2) // 106 → 66 → 26; third rejected
    const bal = (await get('clerkA', `/api/inventory/balances?siteId=${ids.A}`)).body[0].sacks
    expect(bal).toBe(26)
    // restock for later tests
    await post('clerkA', '/api/intakes', { siteId: ids.A, materialId: ids.mat, sacks: 474 }) // → 500
  })

  it('duplicate M-Pesa references are flagged', async () => {
    const mk = () => post('clerkA', '/api/sales', { siteId: ids.A, materialId: ids.mat, sacks: 1, unitPrice: 100, method: 'MPESA', paymentRef: 'QK12ABC34' })
    expect((await mk()).status).toBe(201)
    expect((await mk()).body.code).toBe('DUPLICATE_PAYMENT_REF')
  })

  it('AC-009/AC-008/BR-008: cancellation needs approval by a different approver; history is preserved', async () => {
    expect((await post('clerkA', `/api/sales/${saleId}/cancel`, { reason: 'Customer returned the goods' })).status).toBe(403)
    const req = await post('manager', `/api/sales/${saleId}/cancel`, { reason: 'Customer returned the goods' })
    expect(req.status).toBe(202)
    expect((await post('manager', `/api/sales/${saleId}/cancel`, { reason: 'Customer returned the goods' })).status).toBe(409) // already pending
    // still active until approved
    expect((await get('clerkA', `/api/sales?siteId=${ids.A}&q=Acme`)).body[0].status).toBe('ACTIVE')
    const self = await post('manager', `/api/approvals/${req.body.id}/decide`, { approved: true })
    expect(self.status).toBe(403)
    expect(self.body.code).toBe('SELF_APPROVAL')
    const before = (await get('clerkA', `/api/inventory/balances?siteId=${ids.A}`)).body[0].sacks
    const ok = await post('finance', `/api/approvals/${req.body.id}/decide`, { approved: true, comment: 'verified' })
    expect(ok.body.status).toBe('APPROVED')
    expect((await post('manager2', `/api/approvals/${req.body.id}/decide`, { approved: true })).status).toBe(409)
    const sale = (await get('clerkA', `/api/sales?siteId=${ids.A}&q=Acme`)).body[0]
    expect(sale.status).toBe('CANCELLED')
    expect(sale.cancelReason).toBe('Customer returned the goods')
    expect(Number(sale.total)).toBe(15005) // original preserved
    expect((await get('clerkA', `/api/inventory/balances?siteId=${ids.A}`)).body[0].sacks).toBe(before + 10)
    const types = (await get('finance', `/api/cash/entries?siteId=${ids.A}`)).body.filter((c: { sourceId: string }) => c.sourceId === saleId).map((c: { category: string }) => c.category)
    expect(types.sort()).toEqual(['SALE', 'SALE_REFUND'])
  })

  it('rejection needs a comment and leaves the sale untouched', async () => {
    const s = await post('clerkA', '/api/sales', { siteId: ids.A, materialId: ids.mat, sacks: 2, unitPrice: 10, method: 'CASH', buyerName: 'Keep Me' })
    const req = await post('finance', `/api/sales/${s.body.id}/cancel`, { reason: 'Entered wrong buyer by mistake' })
    expect((await post('manager', `/api/approvals/${req.body.id}/decide`, { approved: false })).status).toBe(422)
    const rej = await post('manager', `/api/approvals/${req.body.id}/decide`, { approved: false, comment: 'Not valid' })
    expect(rej.body.status).toBe('REJECTED')
    expect((await get('clerkA', `/api/sales?q=Keep`)).body[0].status).toBe('ACTIVE')
  })
})

describe('worker pay', () => {
  let work1 = ''
  it('AC-005: payout is calculated from the approved rate with a visible breakdown', async () => {
    const r = await post('supervisor', '/api/work-records', { siteId: ids.A, workerId: ids.worker, workDate: today, basis: 'PER_SACK', quantity: 25 })
    expect(r.status).toBe(201)
    expect(Number(r.body.expectedAmount)).toBe(1000)
    expect(r.body.breakdown.formula).toBe('25 × 40 = 1000')
    work1 = r.body.id
    const d = await post('supervisor', '/api/work-records', { siteId: ids.A, workerId: ids.worker, workDate: today, basis: 'PER_DAY', quantity: 1 })
    expect(Number(d.body.expectedAmount)).toBe(700)
  })

  it('rates are effective-dated: a new rate does not change earlier work', async () => {
    await post('manager', '/api/rates', { basis: 'PER_SACK', rate: 50, effectiveFrom: '2026-06-01' })
    const old = await post('supervisor', '/api/work-records', { siteId: ids.A, workerId: ids.worker, workDate: '2026-03-01', basis: 'PER_SACK', quantity: 10 })
    expect(Number(old.body.expectedAmount)).toBe(400)
    const cur = await post('supervisor', '/api/work-records', { siteId: ids.A, workerId: ids.worker, workDate: today, basis: 'PER_SACK', quantity: 10 })
    expect(Number(cur.body.expectedAmount)).toBe(500)
  })

  it('refuses work with no approved rate; per-task pay needs a task', async () => {
    expect((await post('supervisor', '/api/work-records', { siteId: ids.A, workerId: ids.worker, workDate: today, basis: 'PER_HOUR', quantity: 3 })).body.code).toBe('NO_RATE')
    expect((await post('supervisor', '/api/work-records', { siteId: ids.A, workerId: ids.worker, workDate: today, basis: 'PER_TASK', quantity: 1 })).body.code).toBe('TASK_REQUIRED')
  })

  it('offline retries do not duplicate work records', async () => {
    const b = { siteId: ids.A, workerId: ids.worker, workDate: today, basis: 'PER_DAY', quantity: 1, clientId: 'work-retry-0001' }
    const a = await post('supervisor', '/api/work-records', b)
    const c = await post('supervisor', '/api/work-records', b)
    expect(c.body.id).toBe(a.body.id)
  })

  it('payout requires verification by a different person', async () => {
    const early = await post('finance', '/api/payouts', { siteId: ids.A, workerId: ids.worker, workRecordIds: [work1], method: 'CASH' })
    expect(early.body.code).toBe('UNVERIFIED_WORK')
    expect((await post('supervisor', `/api/work-records/${work1}/verify`)).body.code).toBe('SELF_APPROVAL')
    expect((await post('manager', `/api/work-records/${work1}/verify`)).status).toBe(200)
  })

  it('AC-006/BR-006: amount due and amount paid are separate; shortfalls must be explained; overpay is refused', async () => {
    const over = await post('finance', '/api/payouts', { siteId: ids.A, workerId: ids.worker, workRecordIds: [work1], amountPaid: 1200, method: 'CASH' })
    expect(over.body.code).toBe('OVERPAYMENT')
    const noNote = await post('finance', '/api/payouts', { siteId: ids.A, workerId: ids.worker, workRecordIds: [work1], amountPaid: 800, method: 'CASH' })
    expect(noNote.body.code).toBe('SHORTFALL_NOTE_REQUIRED')
    const p = await post('finance', '/api/payouts', { siteId: ids.A, workerId: ids.worker, workRecordIds: [work1], amountPaid: 800, method: 'MPESA', paymentRef: 'MP-REF-1', shortfallNote: 'KES 200 advance already given' })
    expect(p.status).toBe(201)
    expect(Number(p.body.expectedAmount)).toBe(1000)
    expect(Number(p.body.amountPaid)).toBe(800)
    expect(p.body.status).toBe('PENDING')
    // not in cashbook until approved
    const before = (await get('finance', `/api/cash/entries?siteId=${ids.A}`)).body.filter((c: { category: string }) => c.category === 'WORKER_PAYOUT')
    expect(before).toHaveLength(0)
    // work cannot be paid twice (FR-015)
    expect((await post('finance', '/api/payouts', { siteId: ids.A, workerId: ids.worker, workRecordIds: [work1], method: 'CASH' })).body.code).toBe('ALREADY_PAID')
    const appr = (await get('manager', '/api/approvals?status=PENDING&type=PAYOUT')).body[0]
    expect((await post('finance', `/api/approvals/${appr.id}/decide`, { approved: true })).status).toBe(403) // finance recorded it
    expect((await post('manager', `/api/approvals/${appr.id}/decide`, { approved: true })).body.status).toBe('APPROVED')
    const after = (await get('finance', `/api/cash/entries?siteId=${ids.A}`)).body.filter((c: { category: string }) => c.category === 'WORKER_PAYOUT')
    expect(after).toHaveLength(1)
    expect(Number(after[0].amount)).toBe(800)
    expect(after[0].method).toBe('MPESA')
  })

  it('duplicate M-Pesa payout references are blocked; rejecting a payout frees the work', async () => {
    const wr = await post('supervisor', '/api/work-records', { siteId: ids.A, workerId: ids.worker, workDate: today, basis: 'PER_DAY', quantity: 2 })
    await post('manager', `/api/work-records/${wr.body.id}/verify`)
    const dup = await post('finance', '/api/payouts', { siteId: ids.A, workerId: ids.worker, workRecordIds: [wr.body.id], method: 'MPESA', paymentRef: 'MP-REF-1' })
    expect(dup.body.code).toBe('DUPLICATE_PAYMENT_REF')
    const p = await post('finance', '/api/payouts', { siteId: ids.A, workerId: ids.worker, workRecordIds: [wr.body.id], method: 'CASH' })
    expect(p.status).toBe(201)
    const appr = (await get('manager', '/api/approvals?status=PENDING&type=PAYOUT')).body.find((a: { entityId: string }) => a.entityId === p.body.id)
    await post('manager', `/api/approvals/${appr.id}/decide`, { approved: false, comment: 'Wrong quantity' })
    const retry = await post('finance', '/api/payouts', { siteId: ids.A, workerId: ids.worker, workRecordIds: [wr.body.id], method: 'CASH' })
    expect(retry.status).toBe(201)
  })

  it('high-value payouts need two different approvers', async () => {
    await post('owner', '/api/rates', { basis: 'PER_SHIFT', rate: 30000, effectiveFrom: '2026-01-01' })
    const wr = await post('supervisor', '/api/work-records', { siteId: ids.A, workerId: ids.worker, workDate: today, basis: 'PER_SHIFT', quantity: 2 })
    await post('manager', `/api/work-records/${wr.body.id}/verify`)
    const p = await post('finance', '/api/payouts', { siteId: ids.A, workerId: ids.worker, workRecordIds: [wr.body.id], method: 'CASH' })
    const appr = (await get('manager', '/api/approvals?status=PENDING&type=PAYOUT')).body.find((a: { entityId: string }) => a.entityId === p.body.id)
    expect(appr.requiredSteps).toBe(2)
    const s1 = await post('manager', `/api/approvals/${appr.id}/decide`, { approved: true })
    expect(s1.body.status).toBe('PENDING')
    expect((await post('manager', `/api/approvals/${appr.id}/decide`, { approved: true })).status).toBe(409)
    const s2 = await post('owner', `/api/approvals/${appr.id}/decide`, { approved: true })
    expect(s2.body.status).toBe('APPROVED')
  })
})

describe('cashbook, expenses and shift close', () => {
  it('AC-007: variance between expected and counted needs an explanation; closed days cannot be closed twice', async () => {
    await post('manager', '/api/cash/entries', { siteId: ids.B, direction: 'IN', category: 'FLOAT', amount: 5000, method: 'CASH', note: 'Opening float' })
    const sum = (await get('finance', `/api/cash/summary?siteId=${ids.B}&date=${today}`)).body
    expect(Number(sum.expectedCash)).toBe(5000)
    const short = await post('finance', '/api/cash/shift-close', { siteId: ids.B, businessDate: today, countedCash: 4800, mpesaCounted: 0 })
    expect(short.body.code).toBe('VARIANCE_EXPLANATION_REQUIRED')
    const ok = await post('finance', '/api/cash/shift-close', { siteId: ids.B, businessDate: today, countedCash: 4800, mpesaCounted: 0, explanation: 'KES 200 change owed to buyer' })
    expect(ok.status).toBe(201)
    expect(Number(ok.body.close.cashVariance)).toBe(-200)
    expect((await post('finance', '/api/cash/shift-close', { siteId: ids.B, businessDate: today, countedCash: 4800, mpesaCounted: 0, explanation: 'again' })).body.code).toBe('ALREADY_CLOSED')
    expect((await post('manager', `/api/approvals/${ok.body.approval.id}/decide`, { approved: true })).body.status).toBe('APPROVED')
  })

  it('expenses post to the cashbook only once approved', async () => {
    const e = await post('clerkA', '/api/expenses', { siteId: ids.A, category: 'TRANSPORT', amount: 2500, method: 'CASH', description: 'Haulage' })
    expect(e.status).toBe(201)
    const appr = (await get('manager', '/api/approvals?status=PENDING&type=EXPENSE')).body[0]
    await post('finance', `/api/approvals/${appr.id}/decide`, { approved: true })
    const out = (await get('finance', `/api/cash/entries?siteId=${ids.A}`)).body.find((c: { category: string }) => c.category === 'TRANSPORT')
    expect(Number(out.amount)).toBe(2500)
  })
})

describe('fuel, equipment and safety', () => {
  it('fuel cannot be issued beyond what is on hand', async () => {
    expect((await post('clerkA', '/api/fuel', { siteId: ids.A, kind: 'PURCHASE', category: 'OTHER', litres: 100, cost: 18000, entryDate: today })).status).toBe(201)
    expect((await post('clerkA', '/api/fuel', { siteId: ids.A, kind: 'ISSUE', category: 'GENERATOR', litres: 150, entryDate: today })).body.code).toBe('INSUFFICIENT_FUEL')
    expect((await post('clerkA', '/api/fuel', { siteId: ids.A, kind: 'ISSUE', category: 'GENERATOR', litres: 60, entryDate: today })).status).toBe(201)
    expect(Number((await get('clerkA', `/api/fuel?siteId=${ids.A}`)).body.onHandLitres)).toBe(40)
  })

  it('AC-013: maintenance and safety records can be tracked to closure', async () => {
    const eq = (await post('supervisor', '/api/equipment', { siteId: ids.A, name: 'Excavator 1', category: 'Excavator' })).body
    expect((await post('supervisor', `/api/equipment/${eq.id}/maintenance`, { eventDate: today, description: 'Hydraulic hose replaced', cost: 4500, downtimeHours: 6 })).status).toBe(201)
    expect((await get('supervisor', `/api/equipment/${eq.id}/maintenance`)).body).toHaveLength(1)
    const s = (await post('safety', '/api/safety', { siteId: ids.A, kind: 'INCIDENT', title: 'Minor rockfall', severity: 'MEDIUM' })).body
    expect((await patch('safety', `/api/safety/${s.id}`, { status: 'CLOSED' })).body.code).toBe('ACTION_REQUIRED')
    expect((await patch('safety', `/api/safety/${s.id}`, { status: 'CLOSED', correctiveAction: 'Bench re-profiled' })).body.status).toBe('CLOSED')
  })
})

describe('reports, exports and audit', () => {
  it('AC-012: summary is filterable by site and date; margin derives from source records', async () => {
    const r = (await get('owner', `/api/reports/summary?siteId=${ids.A}&from=${today}&to=${today}`)).body
    expect(r.sales.count).toBeGreaterThan(0)
    expect(r.margin.revenue).toBe(r.sales.revenue)
    expect(r.margin.costs).toBeCloseTo(r.labour.paidApproved + r.expenses.total + r.fuel.purchaseCost)
    expect((await get('clerkA', `/api/reports/summary?siteId=${ids.B}`)).status).toBe(403)
    const all = (await get('owner', '/api/reports/summary')).body
    expect(all.bySite.intake.length).toBeGreaterThanOrEqual(1)
  })

  it('CSV export works and neutralises spreadsheet formula injection', async () => {
    await post('clerkA', '/api/sales', { siteId: ids.A, materialId: ids.mat, buyerName: '=HYPERLINK("http://evil")', sacks: 1, unitPrice: 5, method: 'CASH' })
    const r = await get('finance', `/api/reports/export?type=sales&siteId=${ids.A}`)
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toMatch(/text\/csv/)
    expect(r.text).toContain(`"'=HYPERLINK(""http://evil"")"`)
    expect((await get('finance', '/api/reports/export?type=nope')).status).toBe(422)
  })

  it('FR-025: key actions are in the audit log with actor, and only authorised roles can read it', async () => {
    const rows = (await get('auditor', '/api/audit?limit=500')).body as { action: string; actorId: string | null }[]
    for (const a of ['LOGIN', 'CREATE', 'APPROVE', 'REJECT', 'USER_CREATE', 'CANCEL_REQUEST', 'SHIFT_CLOSE']) expect(rows.some((r) => r.action === a)).toBe(true)
    expect(rows.filter((r) => r.action === 'APPROVE').every((r) => r.actorId)).toBe(true)
  })

  it('permission changes are audited and admins cannot lock themselves out', async () => {
    expect((await patch('admin', '/api/users/does-not-exist', {})).status).toBe(404)
    const me = (await get('admin', '/api/auth/me')).body.user.id
    expect((await patch('admin', `/api/users/${me}`, { active: false })).body.code).toBe('SELF_CHANGE')
    await patch('admin', `/api/users/${ids.clerkB}`, { role: 'SUPERVISOR' })
    const rows = (await get('auditor', '/api/audit?entity=User')).body as { action: string }[]
    expect(rows.some((r) => r.action === 'USER_UPDATE')).toBe(true)
    // deactivated users are locked out immediately
    await patch('admin', `/api/users/${ids.clerkB}`, { active: false })
    expect((await get('clerkB', '/api/sites')).status).toBe(401)
  })
})
