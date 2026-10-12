import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from './generated/prisma/client.js'

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/digimine'

export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
export { Prisma }
export type Tx = Prisma.TransactionClient
export const D = (v: ConstructorParameters<typeof Prisma.Decimal>[0]) => new Prisma.Decimal(v)
export type Decimal = Prisma.Decimal

// AuditLog.id is a BigInt; make JSON.stringify safe.
;(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
  return this.toString()
}
