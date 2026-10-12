# DIGIMINE — Mining Site Operations Management System

Implements the *Mining Site Operations SRS Draft v1.0*: multi-site ore intake, sack-based inventory ledger,
cash/M-Pesa sales with receipts, casual-labour work records and payouts, fuel/equipment/safety registers,
cashbook with daily reconciliation, multi-step approvals, audit log, reports/CSV export and an
offline-capable field-entry app (installable PWA).

**Stack:** TypeScript everywhere · React + Vite + Tailwind CSS · Node.js + Express · PostgreSQL + Prisma.

## Run it locally

Requires Node 22+ and PostgreSQL 14+.

```bash
# 1. Database
createdb digimine            # default URL: postgresql://postgres:postgres@localhost:5432/digimine

# 2. API (http://localhost:4000)
cd server
npm install
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/digimine
export JWT_SECRET=$(openssl rand -hex 32)      # required when NODE_ENV=production
npx prisma generate && npx prisma migrate deploy
SEED_DEMO=1 npm run db:seed                    # admin + demo sites, one user per role, rates
npm run dev

# 3. Web app (http://localhost:5173, proxies /api to :4000)
cd ../client
npm install
npm run dev
```

Demo logins (after `SEED_DEMO=1`): password `DemoPass123!` for `owner@`, `manager@`, `clerk@`, `supervisor@`,
`finance@`, `safety@`, `auditor@digimine.local`. Administrator: `admin@digimine.local` / `ChangeMe123!`
(set `SEED_ADMIN_PASSWORD` before seeding, and **change all demo credentials before real use**).
Seed without `SEED_DEMO` to create only the administrator.

## Tests

```bash
createdb digimine_test && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/digimine_test npx prisma migrate deploy
cd server && npm test        # 30 API tests covering the SRS acceptance criteria
```

## How the SRS maps to the code

| Area | Where |
|---|---|
| Auth, roles, per-site access (FR-001/002) | `server/src/auth.ts` (permission matrix), `masterdata.ts` |
| Intake, ledger, adjustments, sales, receipts (FR-003..010) | `server/src/operations.ts` |
| Workers, work records, payouts, rates (FR-011..015, FR-034) | `server/src/labour.ts`, `masterdata.ts` |
| Cashbook, shift close, reconciliation (FR-020..023) | `server/src/finance.ts` |
| Fuel, equipment, safety (FR-016/017/028) | `server/src/field.ts` |
| Approvals with thresholds, no self-approval (FR-024, BR-008) | `server/src/approvals.ts` |
| Audit log (FR-025), reports/CSV (FR-026/027) | `masterdata.ts`, `reports.ts` |
| Offline queue + idempotent sync (FR-030/031, BR-011) | `client/src/offline.ts` + `clientId` on every create |

Key rules enforced server-side: stock is a ledger (never overwritten), sales/payouts/expenses post to the cashbook
automatically, finalized records are reversed rather than deleted, a payout can only cover supervisor-verified unpaid
work, M-Pesa references cannot be reused, and no one can approve their own request.

## Not built / open SRS items

Section 14 open questions (sack sizes, rate rules, thresholds, backdating limit, VAT/tax) are implemented as
defaults (approval thresholds and rates are editable in the app; the backdating limit is a server constant) — confirm them at the stakeholder workshop. Not included: attachments/photos (FR-004),
in-app notifications (FR-029), supplier purchase-order workflow (FR-019 beyond expenses), PDF export (receipts and
reports use the browser's print-to-PDF), and automated backups (FR-033: schedule `pg_dump` and test restores).
