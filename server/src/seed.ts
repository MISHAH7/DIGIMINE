import bcrypt from 'bcryptjs'
import { prisma } from './db.js'

/**
 * Seeds an admin account and baseline reference data.
 * Set SEED_DEMO=1 to also create demo sites, one user per role, rates and materials.
 */
export async function seed() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!'
  const hash = await bcrypt.hash(adminPassword, 10)
  await prisma.user.upsert({
    where: { email: 'admin@digimine.local' },
    update: {},
    create: { name: 'System Administrator', email: 'admin@digimine.local', passwordHash: hash, role: 'ADMIN' },
  })

  if (!process.env.SEED_DEMO) return
  const a = await prisma.site.upsert({ where: { code: 'MWA' }, update: {}, create: { code: 'MWA', name: 'Mwatate Pit' } })
  const b = await prisma.site.upsert({ where: { code: 'TAV' }, update: {}, create: { code: 'TAV', name: 'Taveta Ridge' } })
  await prisma.material.upsert({ where: { name: 'Graphite ore (50kg sack)' }, update: {}, create: { name: 'Graphite ore (50kg sack)', sackKg: 50 } })

  const demo = process.env.SEED_DEMO_PASSWORD ?? 'DemoPass123!'
  const users: [string, string, 'OWNER' | 'SITE_MANAGER' | 'CLERK' | 'SUPERVISOR' | 'FINANCE' | 'SAFETY' | 'AUDITOR', string[]][] = [
    ['Olivia Owner', 'owner@digimine.local', 'OWNER', []],
    ['Samuel Manager', 'manager@digimine.local', 'SITE_MANAGER', [a.id, b.id]],
    ['Cathy Clerk', 'clerk@digimine.local', 'CLERK', [a.id]],
    ['Sam Supervisor', 'supervisor@digimine.local', 'SUPERVISOR', [a.id]],
    ['Faith Finance', 'finance@digimine.local', 'FINANCE', [a.id, b.id]],
    ['Sara Safety', 'safety@digimine.local', 'SAFETY', [a.id]],
    ['Ali Auditor', 'auditor@digimine.local', 'AUDITOR', []],
  ]
  const pw = await bcrypt.hash(demo, 10)
  for (const [name, email, role, siteIds] of users) {
    const u = await prisma.user.upsert({ where: { email }, update: {}, create: { name, email, role, passwordHash: pw } })
    for (const siteId of siteIds) await prisma.userSite.upsert({ where: { userId_siteId: { userId: u.id, siteId } }, update: {}, create: { userId: u.id, siteId } })
  }
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@digimine.local' } })
  if ((await prisma.rateRule.count()) === 0) {
    const eff = new Date('2026-01-01T00:00:00Z')
    await prisma.rateRule.createMany({
      data: [
        { basis: 'PER_SACK', rate: 40, effectiveFrom: eff, createdById: owner.id },
        { basis: 'PER_DAY', rate: 700, effectiveFrom: eff, createdById: owner.id },
        { basis: 'PER_SHIFT', rate: 900, effectiveFrom: eff, createdById: owner.id },
        { basis: 'PER_HOUR', rate: 100, effectiveFrom: eff, createdById: owner.id },
        { basis: 'PER_TASK', task: 'Loading', rate: 500, effectiveFrom: eff, createdById: owner.id },
      ],
    })
  }
  if ((await prisma.worker.count()) === 0) await prisma.worker.createMany({ data: [{ name: 'John Mwangi', phone: '0700000001' }, { name: 'Mary Achieng', phone: '0700000002' }] })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => console.log('Seed complete'))
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}
