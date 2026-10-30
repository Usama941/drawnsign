# M1 Core signing (weeks 4-10)

Goal: a sender uploads a PDF, places fields and sends it. Up to N signers sign by link and email OTP. The completed PDF is flattened, sealed, timestamped and verifiable by URL, QR or file upload. Built from PRD sections 8, 11 and 12 and the M1 row in sections 17-18.

Everything runs on Vercel (functions plus Inngest), with pure-JavaScript PDF tools. There is no real sealing certificate yet, so every seal in M1 is a **development seal**: a self-signed certificate, clearly labelled as such everywhere it appears. `goLiveGaps()` stays non-empty for the whole milestone.

Work through the parts in order. Each part ends with its own exit tests and is merged before the next starts. Plan once, then for each task: implement, run tests, commit.

## Constraints for this milestone

| Topic | Decision for M1 | Later fix |
| --- | --- | --- |
| Hosting | All PDF work in Vercel functions (Node runtime) and Inngest steps. Uploads go straight from the browser to Vercel Blob (client upload with a server-issued token), because function request bodies are capped at about 4.5 MB and PDFs can be up to 25 MB. | None needed for hosting itself. |
| Sanitising | qpdf and Ghostscript are native binaries and can't run in Vercel functions. Use **pdf-lib** (maintained fork `@cantoo/pdf-lib`) to rebuild every upload: copy the pages into a new document, then drop JavaScript, OpenAction, additional actions (AA), embedded files, launch/URI actions in annotations, XFA and interactive form scripts. Reject encrypted files, files over 25 MB or 200 pages, and files that fail to parse. | Before public launch (M3): move sanitising into an isolated worker with no network (PRD threat T9), using qpdf and a Ghostscript re-render. Add this to the PRD pre-go-live list. |
| DOCX to PDF | Not in M1. Needs LibreOffice, which can't run on Vercel. | Add a conversion service (for example Gotenberg) in M3 or later. |
| PAdES seal | `@signpdf/signpdf` with a pdf-lib placeholder. The CMS (CAdES-detached, with the signing-certificate-v2 attribute) is built with `pkijs`. The `Signer` interface signs the DER signed attributes, so a KMS signer can be dropped in later. M1 produces **PAdES-B-T** (signature plus timestamp). | B-LT (embedded revocation data) needs a real CA chain. Do it with the real certificate before go-live. |
| Seal certificate | **Development seal**: a self-signed certificate with CN "drawnsign DEVELOPMENT SEAL - NOT TRUSTED", created at runtime with `@peculiar/x509`. Its key pair is generated in memory per server instance and never stored, logged or committed. Each sealed version stores the certificate it was sealed with and `seal_mode = DEVELOPMENT`. Enabled only by `SEAL_MODE=development`; with any other value, sealing refuses to run while `goLiveGaps()` is non-empty. | Real AATL certificate with the key in KMS/HSM (pre-go-live). |
| Timestamp | `TimestampAuthority` interface. Tests use an in-process fake TSA. Development uses a free public RFC 3161 TSA (configurable URL), which is acceptable only because every seal is a development seal. | Commercial TSA from the seal-certificate CA (pre-go-live). |
| Email | `SmtpMailer` (nodemailer) pointed at **Mailpit**, a local email catcher (`docker run -p 1025:1025 -p 8025:8025 axllent/mailpit`; inbox at http://localhost:8025). Used for OTP, invites and signing links. Vercel preview deployments can't reach a local catcher, so emails there are not delivered until Postmark is configured. | Postmark server token (M3 or earlier if previews need email). |
| Rate limiting | Postgres-backed fixed-window limiter (global table, no tenant data) for OTP sends, OTP attempts and public verify. | Edge rate limiting (for example Vercel Firewall rules) at launch. |

## Part M1a: Documents, upload and sanitising

- [x] **T1 Schema.** `documents`, `document_versions` (insert-only evidence table), and `verification_tokens`. Every table gets `tenant_id`, forced RLS and composite `(tenant_id, parent_id)` foreign keys, as in PRD section 10. `documents.public_id` = `DOC-` + 10 Crockford base32 characters. Verification tokens are 128-bit, stored only as a hash, bound to one document version, and expire at the document's retention end (CLAUDE.md rule 2).
- [x] **T2 Upload.** Client upload token route (`customer.documents.send` / `company.documents.send`). The token restricts the path to the session tenant's prefix, PDF content type only, and 25 MB. An Inngest step fetches the blob, enforces the limits and sanitises the file (see constraints). It then stores the clean bytes as a DRAFT version (sha256, page count) and deletes the raw upload. An upload that fails sanitising is rejected and audited.
- [x] **T3 Documents API.** `POST /documents`, `POST /documents/{id}/versions`, `GET /documents/{id}`, `GET /documents/{id}/versions`. DRAFT versions are append-only; there is no edit in place.
- [x] **T4 Mail in development.** `SmtpMailer` plus Mailpit, selected by `SMTP_URL`. Documented in `docs/runbooks/local-dev.md`.
- [x] **T5 Passkey MFA test (carried over from M0).** A software WebAuthn authenticator in the isolation suite (P-256 key, "none" attestation) registers a passkey, signs in with it, and checks that the session is `mfa_verified` and that a company manager is MFA-satisfied. A password-only sign-in by the same user must still not be satisfied. *(Added: a passkey sign-in without user verification (PIN or biometric) also does not count as MFA; Better Auth accepts such sign-ins, so `src/auth/mfa.ts` checks the UV flag.)*

Exit tests (M1a):
- [x] A PDF with JavaScript, an OpenAction, an embedded file and a launch action comes out with none of them. Encrypted, oversized, over-200-page and malformed PDFs are rejected.
- [x] Tenant A cannot read, list or download tenant B's documents or versions via the API or the app role, and its upload tokens can't write under B's prefix.
- [x] UPDATE or DELETE on `document_versions` fails for the app role.
- [x] The passkey sign-in test passes.

## Part M1b: Envelopes, fields and signing

- [ ] **T6 Schema.** `envelopes` (bound to exactly one `document_version_id` and its sha256), `recipients`, `fields`, `signature_events` (insert-only), and `signing_tokens` (hash only, one recipient, one document version, 30-day expiry, unusable once that recipient has signed or declined). All tenant-scoped with composite foreign keys.
- [ ] **T7 Field editor.** A pdf.js (`pdfjs-dist`) viewer with a React field layer. It supports signature, initials, date, text, checkbox and dropdown fields, each assigned to a recipient, and sequential or parallel order.
- [ ] **T8 Send workflow.** `POST /envelopes`, `/send`, `/void`, `/remind`. Sending moves the document DRAFT → SENT and freezes the version hash. Signing-link emails go out by recipient order. An Inngest cron expires envelopes.
- [ ] **T9 Signer session.** `GET /sign/{signingToken}`. External signers have no account. The tenant is resolved server-side from the signing token, through one narrow `SECURITY DEFINER` lookup that finds the recipient by token hash and returns only the tenant id and that one recipient row; it returns nothing for expired tokens or recipients who have signed or declined. Lookups are rate-limited. It is never read from the URL as a tenant id; the token is treated as a credential, like an API key. After that, every query runs inside `withTenant()` for that tenant. A `signingRoute()` wrapper (third router kind) applies this and writes audit entries with the recipient as actor.
- [ ] **T10 Signing.** Electronic-records consent screen, then a 6-digit email OTP (hashed, 10-minute expiry, 5 attempts, rate-limited), then fill fields: draw, type or upload a signature. Complete or decline with a reason. Each completion writes a `signature_event` with the version sha256, IP, user agent and auth method. Status moves SENT → PARTIALLY_SIGNED → COMPLETED.
- [ ] **T11 Flattening.** When the last signer completes, an Inngest step draws all field values and signature images onto the frozen version with pdf-lib, flattens any form fields, and stores the result as a new SIGNED version (insert-only) linked to its parent.

Exit tests (M1b):
- [ ] Three signers in sequential order complete. Recipient 2 can't sign before recipient 1. A declined envelope can't be completed.
- [ ] A signing token for tenant A's envelope can't read or write anything in tenant B. A wrong or expired token, or one whose recipient has already signed or declined, gets 404. Repeated lookups are rate-limited.
- [ ] OTP brute force is stopped after 5 attempts and rate-limited across requests.
- [ ] The SIGNED version is a new `document_versions` row; the SENT version's bytes and hash are unchanged.
- [ ] UPDATE or DELETE on `signature_events` fails for the app role.

## Part M1c: Seal, certificate of completion and verification

- [ ] **T12 Seal and timestamp.**
  - `SealService` builds the PAdES-B-T signature (see constraints) using the `Signer` and the `TimestampAuthority`.
  - Under `SEAL_MODE=development` it uses `DevSealSigner` and the dev certificate. Otherwise it refuses to seal while `goLiveGaps()` is non-empty.
  - The sealed PDF is stored as evidence, written once with retention set.
- [ ] **T13 Footer line and QR.** Every page of every rendered version gets one footer line: document ID, version, status, a verify QR code (`qrcode`) and the verify URL. Development-sealed files also carry "DEVELOPMENT SEAL - NOT FOR REAL USE" in that line. The footer is drawn before sealing.
- [ ] **T14 Certificate of completion.** A separate PDF listing signers (masked), auth methods, IPs, timestamps and the version hash. It is sealed the same way and stored in `completion_certificates` with the seal certificate and `seal_mode`.
- [ ] **T15 Verify page and API.**
  - `GET /verify/{publicId}?t=` and `POST /verify/hash`.
  - Both run through one narrow `SECURITY DEFINER` lookup that returns only the tenant and the public fields from PRD section 12 for one version; nothing else reads across tenants. Expired tokens return nothing.
  - Without the token, the page shows only that the document exists.
  - COMPANY_MANAGED documents use private verification mode (PRD section 12).
  - Rate-limited.
- [ ] **T16 Upload-to-verify.** The browser computes the file's SHA-256 with WebCrypto and sends only the hash. Possible answers: "matches signed version vN", "matches version vN (not signed)", or "no match".
- [ ] **T17 Development-seal display.** In development mode the verify page shows an amber "Development seal - not a trusted signature" banner. It never shows the green "authentic signed document" result for a development seal, and never shows green for any version that was not itself signed (CLAUDE.md rule 8).

Exit tests (M1c, the PRD M1 exit criteria adjusted for the development seal):
- [ ] A document signed by 3 parties verifies on the verify page as "Signed v_N_" with the development-seal banner, and its hash, seal and timestamp checks pass. Opened in Adobe Reader, the signature shows the document unmodified since signing, with the signer identity untrusted because the certificate is self-signed.
- [ ] An altered copy (one byte changed) shows "no match" on upload-to-verify, and its embedded signature fails validation.
- [ ] A DRAFT or SENT version's QR never produces a green result.
- [ ] Verify lookups without the token, or with a wrong one, reveal only that the document exists, and tenant B's data never appears through tenant A's public ID.
- [ ] With `SEAL_MODE` unset, sealing refuses to run, because `goLiveGaps()` is non-empty. With `SEAL_MODE=development`, sealing refuses on a request to `PRODUCTION_HOSTNAME`, and the build and server start refuse in a Vercel production deployment (guard already in `src/lib/seal-mode.ts`).
- [ ] A test fails if any sealed version or certificate has `seal_mode = DEVELOPMENT` but its rendered footer lacks the development-seal text.
