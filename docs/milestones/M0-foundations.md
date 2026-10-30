# M0 Foundations (weeks 1-3)

Goal: a running Next.js app with auth, tenants, row-level security and the audit ledger, proven by automated tests. No document features yet.

Work through the tasks in order. Plan each one, get approval, implement, run tests, commit.

## Tasks

- [ ] **T1 Project setup.** Next.js (App Router) + TypeScript strict, pnpm, ESLint, Prettier, Vitest, GitHub Actions CI running lint, typecheck and tests. `.env.example` with every variable, no real values.
- [ ] **T2 Database.** Drizzle + Neon connection, migrations folder `db/migrations`, a separate app role without UPDATE/DELETE on evidence tables.
- [ ] **T3 Tenancy.** `tenants` table with `workspace_type` enum (`COMPANY_MANAGED`, `PUBLIC_CUSTOMER`), trigger that blocks changing it after insert. `users`, `memberships`, `invitations`.
- [ ] **T4 Row-level security.** RLS on every tenant table; helper `withTenant(session, fn)` that opens a transaction and sets `app.tenant_id`. No query path without it.
- [ ] **T5 Auth.** Better Auth with email + password, email verification, TOTP and passkeys. Session resolves `tenant_id` and `workspace_type`. MFA mandatory for company admins and managers.
- [ ] **T6 Permission catalogues.** Two separate catalogues as in PRD section 4, plus a `can(session, permission)` policy function. Unknown permission = deny.
- [ ] **T7 Routers.** `/api/v1` and `/api/v1/company`; company router returns 404 for `PUBLIC_CUSTOMER` sessions.
- [ ] **T8 Audit ledger.** `audit_ledger` with hash chain, `ledger_anchors` daily job stub, and middleware that writes one entry per mutating call in the same transaction.
- [ ] **T9 Storage + KMS stubs.** S3 client for two buckets (drafts, evidence with Object Lock) and a KMS signing interface with a local fake for tests.

## Exit tests (must all pass in CI)

- [ ] A user in tenant A cannot read or write any row of tenant B, through the API or direct DB queries with the app role.
- [ ] A `PUBLIC_CUSTOMER` session gets 404 on every `/api/v1/company` route.
- [ ] Changing a tenant's `workspace_type` fails.
- [ ] UPDATE or DELETE on `audit_ledger` with the app role fails.
- [ ] Editing any past ledger row (as superuser, in a test) is detected by the chain verifier.
