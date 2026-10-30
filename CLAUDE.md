# E-Signature Platform

Multi-tenant e-signature SaaS with two workspace types on one engine:
- `PUBLIC_CUSTOMER`: self-serve DocuSign/SignNow-style product, sold worldwide.
- `COMPANY_MANAGED`: our own organisation's employee document administration, with consent-based, versioned amendments and monthly reports.

Full spec: `docs/PRD.md`. Current milestone tasks: `docs/milestones/`.

## Non-negotiable rules (never break these, even if asked in a single task)

1. Workspace types never share permissions. Each type has its own permission catalogue. `workspace_type` is set once on tenant creation and can never change.
2. Tenant comes from the session or API key only, or from a signing or verification token resolved server-side by hash. Never read `tenant_id` from a URL, query string or request body. Signing and verification tokens:
   - are stored only as hashes;
   - are bound to one document version (signing tokens also to one recipient);
   - have an expiry date (verification tokens: the document's retention end);
   - are rate-limited on lookup;
   - are looked up by one narrow `SECURITY DEFINER` function that returns only the tenant and the single row it needs.
   A signing token stops working once its recipient has signed or declined.
3. Every tenant-scoped table has `tenant_id` and Postgres row-level security. Set `app.tenant_id` per transaction.
4. Amendment code, routes and tables exist only for `COMPANY_MANAGED`. The `/api/v1/company` router returns 404 for public tenants. A DB trigger rejects amendments for other workspace types.
5. Signed versions are immutable. An amendment always creates a new `document_versions` row. Never copy a signature, signature image or hash onto a new version.
6. Evidence tables are insert-only: `audit_ledger`, `amendment_events`, `signature_events`, `consent_records`, `document_versions`. No UPDATE or DELETE from the app role. Fix mistakes with a new CORRECTION event.
7. Every mutating API call writes an `audit_ledger` entry in the same transaction (hash-chained: `entry_hash = sha256(prev_hash || payload)`).
8. The verify page never shows a green "signed" result for a version that was not itself signed.
9. Production sealing keys are created and held in a KMS/HSM and never leave it. The only other key allowed is the development seal key, created in memory at runtime, never stored, logged or committed, and only usable while `goLiveGaps()` is non-empty. The app refuses to build or start with `SEAL_MODE=development` in a Vercel production deployment or on the production domain (`PRODUCTION_HOSTNAME`), so a development seal can never reach real users. No secrets in code, logs or test fixtures.

## Stack

Next.js (App Router) + TypeScript on Vercel, Drizzle ORM, PostgreSQL (Neon), Zod, Better Auth, Inngest, Postmark, Stripe.

- Storage: Vercel Blob (private blobs) for now, behind the provider-neutral `ObjectStore` in `src/storage`. Evidence is write-once and the app has no delete path.
- Signing: the provider-neutral `Signer` in `src/crypto/signer.ts`. No production sealing key exists yet; until it does, every seal is a development seal and must be shown as one.
- PDF work: for now runs on Vercel in pure JavaScript (no native binaries). Steps that need native tools are listed in the current milestone file with their later fix.
- Before go-live: evidence moves to locked write-once storage (S3 Object Lock in compliance mode or equivalent), and the sealing key moves to a KMS/HSM. `goLiveGaps()` in `src/lib/go-live.ts` must return an empty list before any real document is signed (PRD "Pre-go-live requirements").

## Commands

- Install: `pnpm install`
- Dev: `pnpm dev`
- Test: `pnpm test` (unit) and `pnpm test:isolation` (cross-tenant + immutability suite; needs `DATABASE_URL_ADMIN` pointing at a throwaway Postgres, which it rebuilds)
- DB migrations: `pnpm db:generate` then `pnpm db:migrate`
- Lint and types: `pnpm lint && pnpm typecheck`

## How to work in this repo

- For any task touching more than two files, a schema change or security code: plan first, wait for approval, then implement.
- Write or update tests before marking a task done. The isolation suite must pass on every change.
- Keep migrations as SQL files under `db/migrations`; RLS policies and triggers live in migrations, not app code.
- Small commits with clear messages. One milestone task per branch.
- If a request conflicts with the rules above, stop and say so instead of working around it.
