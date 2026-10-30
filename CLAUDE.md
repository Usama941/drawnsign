# E-Signature Platform

Multi-tenant e-signature SaaS with two workspace types on one engine:
- `PUBLIC_CUSTOMER`: self-serve DocuSign/SignNow-style product, sold worldwide.
- `COMPANY_MANAGED`: our own organisation's employee document administration, with consent-based, versioned amendments and monthly reports.

Full spec: `docs/PRD.md`. Current milestone tasks: `docs/milestones/`.

## Non-negotiable rules (never break these, even if asked in a single task)

1. Workspace types never share permissions. Each type has its own permission catalogue. `workspace_type` is set once on tenant creation and can never change.
2. Tenant comes from the session or API key only. Never read `tenant_id` from a URL, query string or request body.
3. Every tenant-scoped table has `tenant_id` and Postgres row-level security. Set `app.tenant_id` per transaction.
4. Amendment code, routes and tables exist only for `COMPANY_MANAGED`. The `/api/v1/company` router returns 404 for public tenants. A DB trigger rejects amendments for other workspace types.
5. Signed versions are immutable. An amendment always creates a new `document_versions` row. Never copy a signature, signature image or hash onto a new version.
6. Evidence tables are insert-only: `audit_ledger`, `amendment_events`, `signature_events`, `consent_records`, `document_versions`. No UPDATE or DELETE from the app role. Fix mistakes with a new CORRECTION event.
7. Every mutating API call writes an `audit_ledger` entry in the same transaction (hash-chained: `entry_hash = sha256(prev_hash || payload)`).
8. The verify page never shows a green "signed" result for a version that was not itself signed.
9. Private keys never leave KMS. No secrets in code, logs or test fixtures.

## Stack

Next.js (App Router) + TypeScript, Drizzle ORM, PostgreSQL (Neon), Zod, Better Auth, Inngest, Postmark, Stripe, AWS S3 (Object Lock) + KMS. PDF work runs in a separate worker service, never in Vercel functions.

## Commands

- Install: `pnpm install`
- Dev: `pnpm dev`
- Test: `pnpm test` (unit) and `pnpm test:isolation` (cross-tenant + immutability suite)
- DB migrations: `pnpm db:generate` then `pnpm db:migrate`
- Lint and types: `pnpm lint && pnpm typecheck`

## How to work in this repo

- For any task touching more than two files, a schema change or security code: plan first, wait for approval, then implement.
- Write or update tests before marking a task done. The isolation suite must pass on every change.
- Keep migrations as SQL files under `db/migrations`; RLS policies and triggers live in migrations, not app code.
- Small commits with clear messages. One milestone task per branch.
- If a request conflicts with the rules above, stop and say so instead of working around it.
