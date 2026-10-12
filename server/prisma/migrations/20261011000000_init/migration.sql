-- DIGIMINE initial schema (matches prisma/schema.prisma)

CREATE TYPE "Role" AS ENUM ('ADMIN','OWNER','SITE_MANAGER','CLERK','SUPERVISOR','FINANCE','SAFETY','AUDITOR');
CREATE TYPE "PayBasis" AS ENUM ('PER_SACK','PER_SHIFT','PER_DAY','PER_HOUR','PER_TASK');
CREATE TYPE "MovementType" AS ENUM ('OPENING','RECEIPT','SALE','ADJUSTMENT_IN','ADJUSTMENT_OUT','SALE_REVERSAL');
CREATE TYPE "PayMethod" AS ENUM ('CASH','MPESA');
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE','CANCELLED');
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING','APPROVED','REJECTED');
CREATE TYPE "ApprovalType" AS ENUM ('STOCK_ADJUSTMENT','PAYOUT','SALE_CANCEL','EXPENSE','SHIFT_CLOSE');
CREATE TYPE "CashDirection" AS ENUM ('IN','OUT');

CREATE TABLE "User" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "email" TEXT NOT NULL, "passwordHash" TEXT NOT NULL,
  "role" "Role" NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "Site" (
  "id" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Site_code_key" ON "Site"("code");
CREATE UNIQUE INDEX "Site_name_key" ON "Site"("name");

CREATE TABLE "UserSite" (
  "userId" TEXT NOT NULL, "siteId" TEXT NOT NULL,
  CONSTRAINT "UserSite_pkey" PRIMARY KEY ("userId","siteId")
);

CREATE TABLE "Material" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "sackKg" DECIMAL(8,2), "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Material_name_key" ON "Material"("name");

CREATE TABLE "Supplier" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "phone" TEXT, "notes" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Buyer" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "phone" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Buyer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Counter" (
  "key" TEXT NOT NULL, "value" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "Intake" (
  "id" TEXT NOT NULL, "ref" TEXT NOT NULL, "clientId" TEXT, "siteId" TEXT NOT NULL, "materialId" TEXT NOT NULL,
  "supplierId" TEXT, "sacks" INTEGER NOT NULL, "notes" TEXT, "receivedAt" TIMESTAMP(3) NOT NULL,
  "recordedById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "Intake_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Intake_ref_key" ON "Intake"("ref");
CREATE UNIQUE INDEX "Intake_clientId_key" ON "Intake"("clientId");
CREATE INDEX "Intake_siteId_receivedAt_idx" ON "Intake"("siteId","receivedAt");

CREATE TABLE "StockMovement" (
  "id" TEXT NOT NULL, "siteId" TEXT NOT NULL, "materialId" TEXT NOT NULL, "type" "MovementType" NOT NULL,
  "sacks" INTEGER NOT NULL, "refType" TEXT, "refId" TEXT, "note" TEXT, "createdById" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StockMovement_siteId_materialId_occurredAt_idx" ON "StockMovement"("siteId","materialId","occurredAt");

CREATE TABLE "Sale" (
  "id" TEXT NOT NULL, "ref" TEXT NOT NULL, "clientId" TEXT, "siteId" TEXT NOT NULL, "materialId" TEXT NOT NULL,
  "buyerId" TEXT, "buyerName" TEXT NOT NULL, "sacks" INTEGER NOT NULL, "unitPrice" DECIMAL(14,2) NOT NULL,
  "total" DECIMAL(14,2) NOT NULL, "method" "PayMethod" NOT NULL, "paymentRef" TEXT, "soldAt" TIMESTAMP(3) NOT NULL,
  "recordedById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE', "cancelReason" TEXT, "cancelledById" TEXT, "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Sale_ref_key" ON "Sale"("ref");
CREATE UNIQUE INDEX "Sale_clientId_key" ON "Sale"("clientId");
CREATE INDEX "Sale_siteId_soldAt_idx" ON "Sale"("siteId","soldAt");

CREATE TABLE "StockAdjustment" (
  "id" TEXT NOT NULL, "siteId" TEXT NOT NULL, "materialId" TEXT NOT NULL, "sacks" INTEGER NOT NULL,
  "reason" TEXT NOT NULL, "evidence" TEXT, "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Worker" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "phone" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RateRule" (
  "id" TEXT NOT NULL, "basis" "PayBasis" NOT NULL, "task" TEXT, "siteId" TEXT, "rate" DECIMAL(14,2) NOT NULL,
  "effectiveFrom" DATE NOT NULL, "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RateRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RateRule_basis_effectiveFrom_idx" ON "RateRule"("basis","effectiveFrom");

CREATE TABLE "WorkRecord" (
  "id" TEXT NOT NULL, "clientId" TEXT, "siteId" TEXT NOT NULL, "workerId" TEXT NOT NULL, "workDate" DATE NOT NULL,
  "basis" "PayBasis" NOT NULL, "task" TEXT, "quantity" DECIMAL(10,2) NOT NULL, "rate" DECIMAL(14,2) NOT NULL,
  "expectedAmount" DECIMAL(14,2) NOT NULL, "rateRuleId" TEXT, "recordedById" TEXT NOT NULL, "verifiedById" TEXT,
  "verifiedAt" TIMESTAMP(3), "payoutId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkRecord_clientId_key" ON "WorkRecord"("clientId");
CREATE INDEX "WorkRecord_workerId_workDate_idx" ON "WorkRecord"("workerId","workDate");
CREATE INDEX "WorkRecord_siteId_workDate_idx" ON "WorkRecord"("siteId","workDate");

CREATE TABLE "Payout" (
  "id" TEXT NOT NULL, "ref" TEXT NOT NULL, "clientId" TEXT, "siteId" TEXT NOT NULL, "workerId" TEXT NOT NULL,
  "expectedAmount" DECIMAL(14,2) NOT NULL, "amountPaid" DECIMAL(14,2) NOT NULL, "method" "PayMethod" NOT NULL,
  "paymentRef" TEXT, "paidAt" TIMESTAMP(3) NOT NULL, "shortfallNote" TEXT, "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "recordedById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Payout_ref_key" ON "Payout"("ref");
CREATE UNIQUE INDEX "Payout_clientId_key" ON "Payout"("clientId");
CREATE INDEX "Payout_siteId_paidAt_idx" ON "Payout"("siteId","paidAt");

CREATE TABLE "Equipment" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "category" TEXT NOT NULL, "siteId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE', "hours" DECIMAL(10,1) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaintenanceEvent" (
  "id" TEXT NOT NULL, "equipmentId" TEXT NOT NULL, "siteId" TEXT NOT NULL, "eventDate" DATE NOT NULL,
  "description" TEXT NOT NULL, "cost" DECIMAL(14,2) NOT NULL DEFAULT 0, "downtimeHours" DECIMAL(8,1) NOT NULL DEFAULT 0,
  "recordedById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaintenanceEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FuelEntry" (
  "id" TEXT NOT NULL, "clientId" TEXT, "siteId" TEXT NOT NULL, "kind" TEXT NOT NULL, "category" TEXT NOT NULL,
  "equipmentId" TEXT, "supplierId" TEXT, "litres" DECIMAL(10,2) NOT NULL, "cost" DECIMAL(14,2), "entryDate" DATE NOT NULL,
  "recordedById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FuelEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FuelEntry_clientId_key" ON "FuelEntry"("clientId");
CREATE INDEX "FuelEntry_siteId_entryDate_idx" ON "FuelEntry"("siteId","entryDate");

CREATE TABLE "Expense" (
  "id" TEXT NOT NULL, "clientId" TEXT, "siteId" TEXT NOT NULL, "category" TEXT NOT NULL, "description" TEXT,
  "supplierId" TEXT, "amount" DECIMAL(14,2) NOT NULL, "method" "PayMethod" NOT NULL, "paymentRef" TEXT,
  "spentAt" TIMESTAMP(3) NOT NULL, "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING', "recordedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Expense_clientId_key" ON "Expense"("clientId");
CREATE INDEX "Expense_siteId_spentAt_idx" ON "Expense"("siteId","spentAt");

CREATE TABLE "CashEntry" (
  "id" TEXT NOT NULL, "siteId" TEXT NOT NULL, "direction" "CashDirection" NOT NULL, "category" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL, "method" "PayMethod" NOT NULL, "reference" TEXT, "sourceType" TEXT, "sourceId" TEXT,
  "note" TEXT, "occurredAt" TIMESTAMP(3) NOT NULL, "recordedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CashEntry_siteId_occurredAt_idx" ON "CashEntry"("siteId","occurredAt");

CREATE TABLE "ShiftClose" (
  "id" TEXT NOT NULL, "siteId" TEXT NOT NULL, "businessDate" DATE NOT NULL, "openingCash" DECIMAL(14,2) NOT NULL,
  "expectedCash" DECIMAL(14,2) NOT NULL, "countedCash" DECIMAL(14,2) NOT NULL, "cashVariance" DECIMAL(14,2) NOT NULL,
  "mpesaExpected" DECIMAL(14,2) NOT NULL, "mpesaCounted" DECIMAL(14,2) NOT NULL, "mpesaVariance" DECIMAL(14,2) NOT NULL,
  "explanation" TEXT, "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING', "closedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShiftClose_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShiftClose_siteId_businessDate_key" ON "ShiftClose"("siteId","businessDate");

CREATE TABLE "ApprovalRequest" (
  "id" TEXT NOT NULL, "type" "ApprovalType" NOT NULL, "entityId" TEXT NOT NULL, "siteId" TEXT NOT NULL,
  "amount" DECIMAL(14,2), "summary" TEXT NOT NULL, "requiredSteps" INTEGER NOT NULL DEFAULT 1,
  "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING', "requestedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "decidedAt" TIMESTAMP(3),
  CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ApprovalRequest_status_siteId_idx" ON "ApprovalRequest"("status","siteId");

CREATE TABLE "ApprovalDecision" (
  "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "step" INTEGER NOT NULL, "decidedById" TEXT NOT NULL,
  "approved" BOOLEAN NOT NULL, "comment" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApprovalDecision_requestId_decidedById_key" ON "ApprovalDecision"("requestId","decidedById");

CREATE TABLE "SafetyRecord" (
  "id" TEXT NOT NULL, "clientId" TEXT, "siteId" TEXT NOT NULL, "kind" TEXT NOT NULL, "title" TEXT NOT NULL,
  "description" TEXT, "severity" TEXT NOT NULL DEFAULT 'LOW', "correctiveAction" TEXT, "owner" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN', "occurredAt" TIMESTAMP(3) NOT NULL, "reportedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SafetyRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SafetyRecord_clientId_key" ON "SafetyRecord"("clientId");

CREATE TABLE "Setting" (
  "key" TEXT NOT NULL, "value" JSONB NOT NULL,
  CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "AuditLog" (
  "id" BIGSERIAL NOT NULL, "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "actorId" TEXT, "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL, "entityId" TEXT, "siteId" TEXT, "detail" JSONB,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity","entityId");
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

ALTER TABLE "UserSite" ADD CONSTRAINT "UserSite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSite" ADD CONSTRAINT "UserSite_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity guards (NFR-004, BR-009): the audit log and stock ledger are append-only.
CREATE FUNCTION digimine_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: table is append-only', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION digimine_block_mutation();
CREATE TRIGGER "StockMovement_append_only" BEFORE UPDATE OR DELETE ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION digimine_block_mutation();
CREATE TRIGGER "ApprovalDecision_append_only" BEFORE UPDATE OR DELETE ON "ApprovalDecision"
  FOR EACH ROW EXECUTE FUNCTION digimine_block_mutation();
