import { Router } from 'express'
import { z } from 'zod'
import { D, prisma } from './db.js'
import { assertSite, requirePerm, siteWhere } from './auth.js'
import { audit, conflict, DATE_RE, dateOnly, notFound, pageParams, parse, str, unprocessable } from './lib.js'
import { checkEventDate, checkEventTime, clientIdField, idempotent } from './operations.js'

export const fieldRouter = Router()

// ---- Fuel (FR-016) ---------------------------------------------------------------------------
const fuelSchema = z.object({
  siteId: z.string().min(1),
  kind: z.enum(['PURCHASE', 'ISSUE']),
  category: z.enum(['EQUIPMENT', 'GENERATOR', 'VEHICLE', 'OTHER']),
  equipmentId: z.string().optional(),
  supplierId: z.string().optional(),
  litres: z.coerce.number().positive().max(1_000_000),
  cost: z.coerce.number().nonnegative().optional(),
  entryDate: z.string().regex(DATE_RE),
  clientId: clientIdField,
})

fieldRouter.post('/fuel', requirePerm('fuel.create'), async (req, res) => {
  const user = req.user!
  const b = parse(fuelSchema, req.body)
  assertSite(user, b.siteId)
  if (b.kind === 'PURCHASE' && b.cost === undefined) throw unprocessable('Cost is required for a fuel purchase', 'COST_REQUIRED')
  checkEventDate(b.entryDate, user.role)
  const { row, duplicate } = await idempotent(
    b.clientId,
    (clientId) => prisma.fuelEntry.findUnique({ where: { clientId } }),
    () =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fuel:${b.siteId}`}))`
        if (b.kind === 'ISSUE') {
          const [p, i] = await Promise.all([
            tx.fuelEntry.aggregate({ where: { siteId: b.siteId, kind: 'PURCHASE' }, _sum: { litres: true } }),
            tx.fuelEntry.aggregate({ where: { siteId: b.siteId, kind: 'ISSUE' }, _sum: { litres: true } }),
          ])
          const onHand = (p._sum.litres ?? D(0)).sub(i._sum.litres ?? D(0))
          if (onHand.lt(b.litres)) throw conflict(`Insufficient fuel on hand: ${onHand} L available`, 'INSUFFICIENT_FUEL')
        }
        const f = await tx.fuelEntry.create({
          data: { clientId: b.clientId, siteId: b.siteId, kind: b.kind, category: b.category, equipmentId: b.equipmentId, supplierId: b.supplierId, litres: D(b.litres), cost: b.cost === undefined ? undefined : D(b.cost), entryDate: dateOnly(b.entryDate), recordedById: user.id },
        })
        await audit(tx, user.id, 'CREATE', 'FuelEntry', f.id, b.siteId, { kind: b.kind, litres: b.litres, cost: b.cost })
        return f
      }),
  )
  res.status(duplicate ? 200 : 201).json({ ...row, duplicate })
})

fieldRouter.get('/fuel', requirePerm('business.read'), async (req, res) => {
  const { take, skip } = pageParams(req.query)
  const from = str(req.query.from)
  const to = str(req.query.to)
  const where = {
    ...siteWhere(req.user!, str(req.query.siteId)),
    ...(from || to ? { entryDate: { ...(from ? { gte: dateOnly(from) } : {}), ...(to ? { lte: dateOnly(to) } : {}) } } : {}),
  }
  const [rows, p, i] = await Promise.all([
    prisma.fuelEntry.findMany({ where, orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }], take, skip }),
    prisma.fuelEntry.aggregate({ where: { ...siteWhere(req.user!, str(req.query.siteId)), kind: 'PURCHASE' }, _sum: { litres: true } }),
    prisma.fuelEntry.aggregate({ where: { ...siteWhere(req.user!, str(req.query.siteId)), kind: 'ISSUE' }, _sum: { litres: true } }),
  ])
  res.json({ entries: rows, onHandLitres: (p._sum.litres ?? D(0)).sub(i._sum.litres ?? D(0)) })
})

// ---- Equipment & maintenance (FR-017) ----------------------------------------------------------
fieldRouter.get('/equipment', requirePerm('business.read'), async (req, res) => {
  res.json(await prisma.equipment.findMany({ where: siteWhere(req.user!, str(req.query.siteId)), orderBy: { name: 'asc' } }))
})
fieldRouter.post('/equipment', requirePerm('equipment.manage'), async (req, res) => {
  const user = req.user!
  const b = parse(z.object({ siteId: z.string().min(1), name: z.string().min(2), category: z.string().min(2) }), req.body)
  assertSite(user, b.siteId)
  const e = await prisma.equipment.create({ data: b })
  await audit(prisma, user.id, 'CREATE', 'Equipment', e.id, b.siteId, b)
  res.status(201).json(e)
})
fieldRouter.patch('/equipment/:id', requirePerm('equipment.manage'), async (req, res) => {
  const user = req.user!
  const b = parse(z.object({ status: z.enum(['ACTIVE', 'DOWN', 'RETIRED']).optional(), hours: z.coerce.number().nonnegative().optional() }), req.body)
  const cur = await prisma.equipment.findUnique({ where: { id: String(req.params.id) } })
  if (!cur) throw notFound('Equipment not found')
  assertSite(user, cur.siteId)
  const e = await prisma.equipment.update({ where: { id: cur.id }, data: { status: b.status, hours: b.hours === undefined ? undefined : D(b.hours) } })
  await audit(prisma, user.id, 'UPDATE', 'Equipment', e.id, e.siteId, b)
  res.json(e)
})
fieldRouter.post('/equipment/:id/maintenance', requirePerm('equipment.manage'), async (req, res) => {
  const user = req.user!
  const b = parse(
    z.object({ eventDate: z.string().regex(DATE_RE), description: z.string().min(3).max(500), cost: z.coerce.number().nonnegative().default(0), downtimeHours: z.coerce.number().nonnegative().default(0) }),
    req.body,
  )
  const eq = await prisma.equipment.findUnique({ where: { id: String(req.params.id) } })
  if (!eq) throw notFound('Equipment not found')
  assertSite(user, eq.siteId)
  const m = await prisma.maintenanceEvent.create({
    data: { equipmentId: eq.id, siteId: eq.siteId, eventDate: dateOnly(b.eventDate), description: b.description, cost: D(b.cost), downtimeHours: D(b.downtimeHours), recordedById: user.id },
  })
  await audit(prisma, user.id, 'CREATE', 'MaintenanceEvent', m.id, eq.siteId, b)
  res.status(201).json(m)
})
fieldRouter.get('/equipment/:id/maintenance', requirePerm('business.read'), async (req, res) => {
  const eq = await prisma.equipment.findUnique({ where: { id: String(req.params.id) } })
  if (!eq) throw notFound('Equipment not found')
  assertSite(req.user!, eq.siteId)
  res.json(await prisma.maintenanceEvent.findMany({ where: { equipmentId: eq.id }, orderBy: { eventDate: 'desc' } }))
})

// ---- Safety (FR-028, AC-013) ----------------------------------------------------------------------
fieldRouter.post('/safety', requirePerm('safety.write'), async (req, res) => {
  const user = req.user!
  const b = parse(
    z.object({
      siteId: z.string().min(1),
      kind: z.enum(['INCIDENT', 'HAZARD', 'INSPECTION']),
      title: z.string().min(3).max(150),
      description: z.string().max(2000).optional(),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('LOW'),
      correctiveAction: z.string().max(1000).optional(),
      owner: z.string().max(100).optional(),
      occurredAt: z.coerce.date().optional(),
      clientId: clientIdField,
    }),
    req.body,
  )
  assertSite(user, b.siteId)
  const when = checkEventTime(b.occurredAt, user.role)
  const { row, duplicate } = await idempotent(
    b.clientId,
    (clientId) => prisma.safetyRecord.findUnique({ where: { clientId } }),
    async () => {
      const s = await prisma.safetyRecord.create({ data: { ...b, occurredAt: when, reportedById: user.id } })
      await audit(prisma, user.id, 'CREATE', 'SafetyRecord', s.id, b.siteId, { kind: b.kind, severity: b.severity })
      return s
    },
  )
  res.status(duplicate ? 200 : 201).json({ ...row, duplicate })
})
fieldRouter.get('/safety', requirePerm('business.read'), async (req, res) => {
  const status = str(req.query.status)
  res.json(await prisma.safetyRecord.findMany({ where: { ...siteWhere(req.user!, str(req.query.siteId)), ...(status ? { status } : {}) }, orderBy: { occurredAt: 'desc' }, take: 300 }))
})
fieldRouter.patch('/safety/:id', requirePerm('safety.write'), async (req, res) => {
  const user = req.user!
  const b = parse(
    z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'CLOSED']).optional(), correctiveAction: z.string().max(1000).optional(), owner: z.string().max(100).optional() }),
    req.body,
  )
  const cur = await prisma.safetyRecord.findUnique({ where: { id: String(req.params.id) } })
  if (!cur) throw notFound('Safety record not found')
  assertSite(user, cur.siteId)
  if (b.status === 'CLOSED' && !(b.correctiveAction ?? cur.correctiveAction)) throw unprocessable('Record a corrective action before closing', 'ACTION_REQUIRED')
  const s = await prisma.safetyRecord.update({ where: { id: cur.id }, data: b })
  await audit(prisma, user.id, 'UPDATE', 'SafetyRecord', s.id, s.siteId, b)
  res.json(s)
})
