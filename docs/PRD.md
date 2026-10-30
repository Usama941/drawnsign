# E-Signature Platform — PRD & Architecture (v0.1 for approval)

Oct 30, 2026 · @OZ

## CTO summary

Recommendation: build one platform with two hard-separated workspace types, and ship the company-managed amendment system as a **tiered, versioned, re-consent model** — not as silent editing of signed documents. That is the only version of the feature that survives a dispute, an audit or a tribunal.

**How I understand the business.** Two products on one engine. PUBLIC\_CUSTOMER is a subscription e-signature SaaS competing with DocuSign/SignNow on price and simplicity. COMPANY\_MANAGED is our own organisation's HR and contract administration: managers issue documents to employees, and authorised admins maintain those documents over time with a full, independent audit trail and monthly transparency reports.

**Top five architectural risks**

1. **Misrepresentation risk (highest).** A clean amended PDF that looks identical to a signed original can be shown to a court, bank or regulator as "what the employee signed". Mitigation: amended versions never inherit the signature, signature appearance or hash; every rendered PDF carries a small footer line (document ID, version, status, verify QR) — an identifier, not a watermark; material changes require the employee to sign the new version.
2. **Consent will not stretch as far as the brief hopes.** Under UK and Pakistani employment law, a pre-signed consent to future amendments is read narrowly; it cannot authorise changes to core terms (pay, hours, duties, notice, restrictive covenants). The design therefore classifies every amendment into three classes with different approval rules (section 8–9).
3. **Cross-tenant leakage.** One bug that lets a COMPANY\_MANAGED role touch a PUBLIC\_CUSTOMER document destroys the public product's trust. Mitigation: Postgres row-level security keyed on tenant, separate permission catalogues per workspace type, and no amendment code path reachable from public workspaces.
4. **Insider abuse of the amendment tool.** An administrator with editing rights is the most likely attacker. Mitigation: append-only audit ledger with hash chaining, four-eyes approval for material changes, and reports delivered directly to the employee.
5. **Signature-law fit across three jurisdictions.** Simple e-signatures are fine for most employment documents in the UK and EU; Pakistan's Electronic Transactions Ordinance excludes some document types and gives stronger presumptions only to certified "advanced" signatures. The MVP ships simple e-signatures with strong evidence; advanced/qualified signatures are a later integration.

**Decisions I need from you before development**

- [ ] Approve the three-class amendment model (clerical / administrative / material) and that material changes require re-signing.
- [ ] Approve a one-line identification footer on every page (doc ID + version + QR) in place of "no marks at all".
- [ ] Confirm COMPANY\_MANAGED is one workspace for our organisation only in v1 (not resold to other employers).
- [ ] Decided: the public workspace is global (US, UK, EU and rest of world). Approve launching UK + US together, EU next.
- [ ] Approve the stack and the MVP scope in sections 17–19.

**Founder decisions (30 Oct 2026) and how the design takes them in**

- **Confidentiality first.** Employees sign an Internal Use and Confidentiality Agreement before the consent; added as Step 0 in section 6, with private-only verification for company documents (section 12). One part must be reworded: a clause saying the documents can never be used in court or legal proceedings will not hold. UK law voids terms that stop employees bringing tribunal claims or reporting crimes, whistleblowing law overrides it, and courts can order disclosure anyway (section 16). The company also needs these records in court to defend itself. Recommended wording: confidential internal records, not to be shared publicly or with third parties, except where the law requires or permits it (courts, tribunals, regulators, police, legal advisers, whistleblowing). This changes nothing in the integrity design: every record must stand up as if it will reach a court, because some will.
- **Public workspace is worldwide.** US law (ESIGN/UETA) and a global-readiness checklist are added to section 16; UK and US launch together at M3.

## 1. Product Requirements Document

The product is a multi-tenant e-signature platform with two workspace types that share an engine but never share permissions.

**Goals**

- PUBLIC\_CUSTOMER: a self-serve DocuSign/SignNow alternative a small business can buy and send its first document with in under 10 minutes.
- COMPANY\_MANAGED: a controlled environment where our organisation issues, maintains and transparently amends employee documents, with evidence that would stand up in a tribunal.
- Both: every document independently verifiable by a third party via URL and QR, without exposing its contents.

**Non-goals (v1)**: qualified electronic signatures (QES), bulk send over 500 recipients, native mobile apps, in-app document negotiation/redlining, reselling COMPANY\_MANAGED to other employers.

**Personas**

| Persona | Workspace | Core job |
| --- | --- | --- |
| Platform Super-Admin (our staff) | Platform | Operate the platform, billing, abuse handling — no content access to public tenants |
| Company Administrator | COMPANY\_MANAGED | Invite managers, set amendment policy, approve material changes, receive reports |
| Manager | COMPANY\_MANAGED | Create, send and track employee documents; propose amendments |
| Employee | COMPANY\_MANAGED | Consent, sign, receive notices, acknowledge or dispute amendments |
| Customer Owner / Admin | PUBLIC\_CUSTOMER | Buy subscription, manage team, templates and branding |
| Customer Sender | PUBLIC\_CUSTOMER | Upload, place fields, send, track, download |
| External Signer | Either (no account needed in public) | Review and sign via secure link |
| Public Verifier | None | Check authenticity of a document via URL/QR |

**Functional requirements — shared engine**

1. PDF upload (≤ 25 MB, ≤ 200 pages), DOCX→PDF conversion, templates with merge fields.
2. Field placement: signature, initials, date, text, checkbox, dropdown; per-signer assignment; signing order (sequential/parallel).
3. Signing: draw/type/upload signature, email OTP (SMS OTP optional), consent to electronic records, decline-to-sign with reason.
4. Completion: flattened signed PDF, certificate of completion (audit trail page set as a separate PDF), SHA-256 hash, PAdES signature by the platform's document-sealing certificate, RFC 3161 timestamp.
5. Verification: unique ID, URL, QR, public status page, upload-to-verify (hash match).
6. Notifications: email (transactional), reminders, expiry, webhooks.
7. Billing: plans, seats, envelope quotas, Stripe checkout, invoices, VAT.

**Functional requirements — COMPANY\_MANAGED only**

1. Admin-to-manager invitations with versioned Manager Administrative Agreement.
2. Manager-to-employee invitations with versioned Employee Document Administration Consent.
3. Amendment proposals with class (clerical / administrative / material), reason, diff, approval routing, employee notification, acknowledgement and dispute flows.
4. New-version generation with clean presentation; original signed version preserved immutably.
5. Append-only amendment ledger, correction-as-new-event.
6. Monthly reports per admin, manager and employee (PDF + CSV), auto-emailed.

**Non-functional requirements**

| Area | Target |
| --- | --- |
| Availability | 99.9% monthly for signing and verification |
| Verification page latency | p95 < 500 ms |
| Signed-document durability | Object storage with versioning + object lock; 11 nines |
| Retention | Signed originals ≥ 7 years by default (configurable per tenant, legal hold supported) |
| Audit integrity | Hash-chained ledger; daily anchor hash exported to separate storage |
| Data residency | UK/EU region for v1; Pakistan data in same region unless law requires local hosting |
| Accessibility | WCAG 2.2 AA for signing and verification flows |

**Success metrics (first 6 months)**: 100 paying public workspaces; median send-to-complete < 24 h; zero cross-tenant access incidents; 100% of amendments with linked consent and reason; monthly reports delivered by the 3rd of each month.

## 2. Product architecture

One modular monolith (Next.js) plus a separate document worker, sharing one Postgres database with row-level security; the workspace type decides which permission catalogue and which routers a request can ever reach.

&#91;embedded content: system architecture · 4 layers, 14 components\]

- **Shared**: identity, PDF engine, signing workflow, storage, sealing, verification, notifications, billing, reporting infrastructure.
- **Separated**: permission catalogues, routers (`/api/v1/company` is invisible to public tenants), the amendment service and its tables, agreement types, report audiences.
- **Why a monolith**: one small team, one deploy, shared types; the document worker and signing service are split out only because they need native binaries, long run times and network isolation.
- **Tenancy model**: shared database, shared schema, `tenant_id` on every row, RLS enforced by setting `app.tenant_id` per transaction from the session. A dedicated database per enterprise tenant is possible later without code changes.

## 3. Two user journeys

The journeys meet only in the shared signing step; everything before and after it runs under a different set of rules. The company journey adds two consent gates and a permanent amendment-and-reporting phase; the public journey is a standard buy-send-sign loop.

&#91;embedded content: user journeys · 6 steps each\]

Detailed step-by-step workflows for each gate are in sections 5–7.

## 4. Roles and permission matrix

Permissions live in two separate catalogues, one per workspace type; a role from one catalogue can never be granted in the other, and the Platform Super-Admin has no document-content permissions in PUBLIC\_CUSTOMER at all.

**COMPANY\_MANAGED** (Y = allowed, A = allowed with approval, O = own records only, — = denied)

| Permission | Company Admin | Manager | Employee | Auditor (read-only) |
| --- | --- | --- | --- | --- |
| Invite / suspend managers | Y | — | — | — |
| Publish agreement & consent versions | Y | — | — | — |
| Define amendment policy (classes, approvers) | Y | — | — | — |
| Invite employees | Y | Y (own teams) | — | — |
| Create / upload / send documents | Y | Y (own teams) | — | — |
| View documents | Y (all) | Y (own teams) | O | Y (all) |
| Propose clerical amendment (Class A) | Y | Y | — | — |
| Propose administrative amendment (Class B) | Y | Y | — | — |
| Propose material amendment (Class C) | Y | A | — | — |
| Approve Class B / C amendments | Y (not own proposal) | — | — | — |
| Acknowledge / dispute amendment | — | — | O | — |
| Sign documents / re-sign new versions | — | — | O | — |
| Record correction event | Y | Y (own amendments) | — | — |
| Delete / edit audit records | — | — | — | — |
| View amendment reports | Y (all) | Y (own teams) | O | Y (all) |
| Export reports (PDF/CSV) | Y | Y | O | Y |
| Place legal hold | Y | — | — | — |

**PUBLIC\_CUSTOMER**

| Permission | Owner | Admin | Sender | Viewer | External Signer |
| --- | --- | --- | --- | --- | --- |
| Manage billing & subscription | Y | — | — | — | — |
| Manage users & roles | Y | Y | — | — | — |
| Branding, templates, settings | Y | Y | — | — | — |
| Upload, place fields, send | Y | Y | Y | — | — |
| View documents | Y (all) | Y (all) | O | Y (shared) | O (assigned) |
| Void / resend envelope (before completion) | Y | Y | O | — | — |
| Edit a completed signed document | — | — | — | — | — |
| Sign | — | — | — | — | O |
| Download signed PDF + certificate | Y | Y | O | Y (shared) | O |
| Delete documents (per retention policy) | Y | Y | — | — | — |

**Platform roles (our staff)**

| Permission | Super-Admin | Support Agent | Security Officer |
| --- | --- | --- | --- |
| Create / suspend tenants, manage plans | Y | — | — |
| View tenant metadata (name, plan, usage counts) | Y | Y | Y |
| View PUBLIC\_CUSTOMER document content | — | — | — (break-glass only, customer-authorised, logged, time-boxed) |
| Edit any PUBLIC\_CUSTOMER document | — | — | — |
| Read platform security logs | — | — | Y |
| Act inside COMPANY\_MANAGED | Only via a separately assigned Company Admin account | — | — |

Enforcement is layered: (1) every request resolves `tenant_id` + `workspace_type` from the session, never from the request body; (2) a policy engine checks the permission against the catalogue for that workspace type; (3) Postgres RLS rejects any row outside the session tenant; (4) the amendment service refuses any document whose workspace is not COMPANY\_MANAGED, and the corresponding tables carry a check constraint enforcing it.

## 5–7. Onboarding and consent workflows

All three flows record consent as its own immutable evidence record — agreement version, content hash, identity, timestamp, IP, user agent and the exact checkbox/button text shown — separate from any signature.

**5. Manager onboarding (COMPANY\_MANAGED)**

1. Company Admin enters manager email, team scope and permission set → system creates `invitation` (single-use token, 72 h expiry, hashed at rest).
2. Manager opens link → email ownership proven by the token; sets password or joins via SSO; MFA (TOTP or passkey) is mandatory for managers.
3. Manager is shown the current **Manager Administrative Agreement** (version, effective date) in full, with a scroll-to-end gate.
4. Manager ticks an unticked box and clicks "I accept". Stored: `consent_record` {agreement\_version\_id, sha256 of rendered text, user\_id, timestamp (server + RFC 3161), IP, UA, MFA method}.
5. Account activates; permissions granted only now. If a new agreement version is published, the manager is blocked at next login until re-accepted.

Agreement must cover: scope of authority, the three amendment classes, approval duties, prohibition on misrepresenting amended documents, audit visibility, disciplinary consequences of misuse.

**6. Employee onboarding and consent (COMPANY\_MANAGED)**

0. **Step 0 (founder decision): Internal Use and Confidentiality Agreement.** Before the consent, the employee signs this agreement as its own sealed envelope: company documents are confidential records for internal administration and record-keeping and may not be shared publicly or with outside parties, subject to the legal carve-outs in section 16. Stored as `agreement_versions.kind = CONFIDENTIALITY` plus a consent record, independent of every later document.

1) Manager sends a document to a new employee → invitation email (sent from our domain, naming the manager and company).
2) Employee creates an account; MFA is offered and recommended (email OTP at minimum for signing).
3) Employee reviews the **Employee Document Administration Consent**, written in plain English, presented as a separate step before the document. It states:
   - which change classes admins may make and which always require the employee's signature;
   - that every change creates a new version, the signed original is kept, and the employee is notified within 1 business day;
   - the dispute window (proposed 14 days) and how to dispute;
   - the monthly report the employee will receive;
   - that refusing consent does not prevent signing — material changes will simply always come back for signature.
4) Employee accepts (separate unticked box). Consent stored independently of the document and of the signature.
5) Employee proceeds to review and sign the document.
6) Employee may withdraw consent for future Class B changes at any time; Class B then escalates to Class C (re-signature). Withdrawal is logged and does not affect past events.

Design note: making consent optional-but-default is what makes it defensible. A consent that is a precondition of employment and covers "any change" is the vague blanket consent your brief rightly rules out.

**7. Public customer registration (PUBLIC\_CUSTOMER)**

1. Visitor signs up (email + password, Google, or Microsoft) → email verified.
2. Chooses plan → Stripe Checkout (14-day trial optional) → webhook confirms payment.
3. System provisions a new tenant with `workspace_type = PUBLIC_CUSTOMER`, the user as Owner. The type is immutable after creation.
4. Owner accepts Customer Terms of Service, Data Processing Agreement (we are processor) and Acceptable Use Policy — each stored as a consent record.
5. Onboarding checklist: upload first PDF, place fields, send to self as a test.
6. External signers never need an account: they sign via a unique link + email OTP, and accept the electronic-records consent shown at the start of signing.

There is no path from step 3 that creates a COMPANY\_MANAGED workspace; that type is created only by a Super-Admin script for our own organisation.

## 8–9. Document lifecycle and amendment lifecycle

A document moves forward through immutable versions and never goes back; an amendment is a separate object that produces a new version and is closed only by an employee acknowledgement, a resolved dispute or a new signature.

**8. Document lifecycle (both workspace types)**

| State | Entered when | Can change content? | Exits to |
| --- | --- | --- | --- |
| DRAFT | Upload or template created | Yes (new draft versions) | SENT, DELETED |
| SENT | Envelope sent; version hash frozen | No | PARTIALLY\_SIGNED, DECLINED, VOIDED, EXPIRED |
| PARTIALLY\_SIGNED | First signer completes | No | COMPLETED, DECLINED, VOIDED, EXPIRED |
| COMPLETED | Last signer completes; sealed + timestamped | Never | AMENDED (company only), ARCHIVED |
| DECLINED / VOIDED / EXPIRED | Signer declines, sender voids, deadline passes | No (start a new draft) | ARCHIVED |
| AMENDED (company only) | A new version exists after the signed one | Signed version: never. New version: via amendment flow only | COMPLETED again (if re-signed), ARCHIVED |
| ARCHIVED / LEGAL\_HOLD | Retention policy or admin hold | No | DELETED only after retention ends and no hold |

In PUBLIC\_CUSTOMER workspaces COMPLETED is terminal for content: the only options are download, share, verify or delete per retention. There is no amend button, endpoint or table row.

**9. Amendment lifecycle (COMPANY\_MANAGED only)**

&#91;embedded content: amendment lifecycle · 3 classes, 3 outcomes\]

Rules the flow enforces: the proposer can never approve their own amendment; a Class B change escalates to Class C if the employee has withdrawn consent; a wrong amendment is fixed by a CORRECTION event and version, never by editing the event; every step writes to the ledger and appears in that month's reports.

## 10–11. Database schema and document versioning

Postgres is the system of record; every tenant-scoped table carries `tenant_id` with row-level security, including child tables that could reach the tenant through a parent. Child rows reference their parent with a composite foreign key `(tenant_id, parent_id)`, so a row can never point at another tenant's parent. Evidence tables are insert-only (UPDATE/DELETE revoked from the application role).

**10. Core tables**

| Domain | Table | Key columns | Notes |
| --- | --- | --- | --- |
| Tenancy | `tenants` | id, name, workspace\_type (enum, immutable), region, retention\_years, created\_at | workspace\_type set once by trigger |
| Identity | `users` | id, email, mfa\_methods, status | global identity |
| Identity | `memberships` | user\_id, tenant\_id, role, team\_scope\[\] | role must exist in the catalogue for the tenant's type; FK tenant\_id → tenants |
| Identity | `invitations` | id, tenant\_id, email, role, token\_hash, expires\_at, accepted\_at | single use; FK tenant\_id → tenants |
| Consent | `agreement_versions` | id, tenant\_id, kind (MANAGER\_AGREEMENT, EMPLOYEE\_CONSENT, CONFIDENTIALITY, CUSTOMER\_TOS, DPA, E\_RECORDS), version, body\_sha256, effective\_at | immutable once published; UNIQUE (tenant\_id, id) |
| Consent | `consent_records` | id, tenant\_id, user\_id, agreement\_version\_id, action (ACCEPT, WITHDRAW), ts, tsa\_token, ip, user\_agent, ui\_text\_sha256 | insert-only; FK (tenant\_id, agreement\_version\_id) → agreement\_versions |
| Documents | `documents` | id (DOC-xxxxxx public id), tenant\_id, title, owner\_id, status, current\_version\_id, legal\_hold | the logical document; UNIQUE (tenant\_id, id); FK (tenant\_id, current\_version\_id) → document\_versions |
| Documents | `document_versions` | id, tenant\_id, document\_id, version\_no, parent\_version\_id, kind (DRAFT, SENT, SIGNED, AMENDED, CORRECTION), storage\_key, sha256, page\_count, created\_by, created\_at | insert-only; UNIQUE (tenant\_id, id); FK (tenant\_id, document\_id) → documents; FK (tenant\_id, parent\_version\_id) → document\_versions |
| Documents | `version_text_index` | tenant\_id, version\_id, block\_id, page, bbox, text, text\_sha256 | extracted text used for diffs; FK (tenant\_id, version\_id) → document\_versions |
| Signing | `envelopes` | id, tenant\_id, document\_version\_id, order\_mode, expires\_at, status | binds signers to ONE version; UNIQUE (tenant\_id, id); FK (tenant\_id, document\_version\_id) → document\_versions |
| Signing | `recipients` | id, tenant\_id, envelope\_id, user\_id/email, role, routing\_order, status | UNIQUE (tenant\_id, id); FK (tenant\_id, envelope\_id) → envelopes |
| Signing | `fields` | id, tenant\_id, envelope\_id, recipient\_id, type, page, bbox, value\_ref | FK (tenant\_id, envelope\_id) → envelopes; FK (tenant\_id, recipient\_id) → recipients |
| Signing | `signature_events` | id, tenant\_id, envelope\_id, recipient\_id, version\_sha256, ts, tsa\_token, ip, ua, auth\_method | insert-only; FK (tenant\_id, envelope\_id) → envelopes; FK (tenant\_id, recipient\_id) → recipients |
| Signing | `completion_certificates` | id, tenant\_id, document\_version\_id, cert\_storage\_key, pades\_signature\_ref, sealed\_at | FK (tenant\_id, document\_version\_id) → document\_versions |
| Amendments (COMPANY\_MANAGED only) | `amendments` | id, tenant\_id, document\_id, from\_version\_id, to\_version\_id, class (A/B/C), reason, proposed\_by, was\_signed\_before, requires\_approval, status | CHECK tenant is COMPANY\_MANAGED; UNIQUE (tenant\_id, id); FK (tenant\_id, document\_id) → documents; FK (tenant\_id, from\_version\_id) and (tenant\_id, to\_version\_id) → document\_versions |
| Amendments | `amendment_changes` | id, tenant\_id, amendment\_id, block\_id, original\_text, updated\_text, page, bbox | one row per textual change; FK (tenant\_id, amendment\_id) → amendments |
| Amendments | `amendment_events` | id, tenant\_id, amendment\_id, type (PROPOSED, APPROVED, REJECTED, APPLIED, NOTIFIED, ACKNOWLEDGED, DISPUTED, RESOLVED, CORRECTED, RE\_SIGNED), actor\_id, ts, payload, consent\_record\_ids\[\] | insert-only; FK (tenant\_id, amendment\_id) → amendments |
| Audit | `audit_ledger` | seq, tenant\_id, ts, actor\_id, action, object\_type, object\_id, payload\_sha256, prev\_hash, entry\_hash | hash-chained, insert-only |
| Audit | `ledger_anchors` | date, tenant\_id, last\_seq, root\_hash, external\_ref | daily anchor copied to a separate locked bucket |
| Reporting | `report_runs` | id, tenant\_id, period, audience (ADMIN/MANAGER/EMPLOYEE), recipient\_id, pdf\_key, csv\_key, sha256, emailed\_at |  |
| Verification | `verification_tokens` | public\_id, tenant\_id, document\_id, version\_id, created\_at | non-guessable slug for URL/QR; FK (tenant\_id, document\_id) → documents; FK (tenant\_id, version\_id) → document\_versions |
| Billing | `subscriptions`, `plans`, `usage_counters`, `invoices` | tenant\_id (except `plans`, which is global), Stripe ids, seats, envelope quota | PUBLIC\_CUSTOMER |

Tenant columns and foreign keys:

- Only `users` (global identity), `tenants` and `plans` have no `tenant_id`. Every other table has `tenant_id NOT NULL` and the `tenant_isolation` RLS policy below.
- A child table never relies on its parent for tenant scoping. It stores its own `tenant_id` and has its own RLS policy.
- Every parent table has `UNIQUE (tenant_id, id)`. Every reference from a child to a parent is a composite foreign key `(tenant_id, parent_id) REFERENCES parent (tenant_id, id)`. A plain `parent_id → parent(id)` foreign key is not allowed, because it would let a row in tenant A point at a parent in tenant B.
- `amendment_changes` and `amendment_events` reach `amendments` through the composite key, so they can only exist in COMPANY\_MANAGED tenants as well.

Key isolation rules in SQL:

```sql
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- parent exposes (tenant_id, id); child references both columns
ALTER TABLE documents ADD CONSTRAINT documents_tenant_id_id_key UNIQUE (tenant_id, id);
ALTER TABLE document_versions ADD CONSTRAINT document_versions_document_fk
  FOREIGN KEY (tenant_id, document_id) REFERENCES documents (tenant_id, id);

-- amendments may only exist in COMPANY_MANAGED tenants
CREATE FUNCTION assert_company_managed() RETURNS trigger AS $$
BEGIN
  IF (SELECT workspace_type FROM tenants WHERE id = NEW.tenant_id) <> 'COMPANY_MANAGED' THEN
    RAISE EXCEPTION 'amendments not permitted for this workspace type';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER amendments_type_guard BEFORE INSERT ON amendments
  FOR EACH ROW EXECUTE FUNCTION assert_company_managed();

REVOKE UPDATE, DELETE ON audit_ledger, amendment_events,
  signature_events, consent_records, document_versions FROM app_role;
```

**11. Versioning architecture**

- A document is a chain of immutable versions: v1 DRAFT → v2 SENT → v3 SIGNED → v4 AMENDED → v5 SIGNED (if re-signed). Each version is a separate object in storage with its own SHA-256; nothing is ever overwritten.
- An envelope binds to exactly one `document_version_id` and its hash. Signature events record that hash. A signature can therefore never "move" to another version.
- Amended versions are rendered from the amendment's text changes applied to the source layout, then flattened. The output is clean (no inline markup), but its metadata, footer and verification record all say "Version 4 — amended from signed Version 3".
- Signature images from v3 are **not** copied into v4. v4 shows a signature block reading "Signed version: v3 on 12 Mar 2027 — verify at …" until the employee re-signs (Class C) or acknowledges (Class B).
- Corrections are new versions (kind = CORRECTION) with a `corrects_amendment_id`; the wrong version stays in the chain.
- Storage: S3-compatible bucket with versioning + Object Lock (compliance mode) for SIGNED versions and certificates, retention = tenant policy; drafts in a normal bucket with lifecycle deletion.

## 12. Cryptographic verification architecture

Every completed version is hashed, sealed with a platform certificate and timestamped by a third party, so any copy can be checked offline in Adobe Reader and online on our verify page.

**Layers**

1. **Content hash** — SHA-256 of the final flattened PDF bytes, stored in `document_versions.sha256` and in the audit ledger.
2. **PAdES seal** — the completed PDF is signed (PAdES-B-LT) with our organisation's document-sealing certificate (an AATL-listed certificate from a public CA, e.g. GlobalSign/Entrust, so Adobe shows a green tick). Private key held in a cloud HSM/KMS (AWS KMS or Google Cloud KMS, FIPS 140-2 L3); signing happens via the KMS API — the key never leaves it.
3. **Trusted timestamp** — RFC 3161 token from an external TSA attached to the PDF and stored in DB.
4. **Audit-ledger anchoring** — daily root hash of each tenant's ledger written to a separate Object-Lock bucket (optionally also to a public transparency log later).
5. **Certificate of completion** — separate PDF listing signers, auth methods, IPs, timestamps, version hash; itself sealed.

**Verification URL and QR**

- Public ID: `DOC-` + 10 chars of Crockford base32 (≈ 50 bits) for humans; the QR/URL also carries a 128-bit token: `https://platform.com/verify/DOC-7K3M9QX2RA?t=…`. Without the token the page shows only "document exists" — this blocks enumeration.
- The QR is placed in the footer line of every page of every rendered version.

**What the public verify page shows** (no document contents)

| Field | Shown |
| --- | --- |
| Document ID, title (optional, owner-controlled) | Yes |
| Issuing organisation / workspace display name | Yes |
| Version this QR belongs to + its status (Signed / Amended — not signed / Re-signed / Superseded) | Yes |
| Signed version number, signing dates, signer initials or masked names (e.g. "A. K\*\*\*") | Yes |
| Integrity result for the signed version (hash + seal + timestamp valid) | Yes |
| "Subsequent amendments exist: 2 (1 acknowledged, 1 disputed)" | Yes — required |
| Outstanding approvals or disputes | Yes, as counts and status |
| Amendment text, reasons, admin names | No (internal report only) |

**Upload-to-verify.** Verifier drops a PDF; the browser computes SHA-256 locally (the file is never uploaded) and the page answers: "matches signed version v3", "matches amended version v4 (not the signed version)", or "no match — this file has been altered or is not from this platform". This is the feature that makes misrepresentation of an amended copy detectable.

**Rule set enforced in code**: a seal on version N attests only the bytes of version N; the verify page must never display a green "authentic signed document" result for a version that was not itself signed.

**Private verification mode for COMPANY\_MANAGED documents (founder decision).** The QR and URL stay on every page, but the verify page requires sign-in as an in-scope admin or manager, or as the document's own employee. Anyone else sees only that it is a confidential internal record and verification is restricted. Integrity checks (hash, seal, timestamp, amendment status) are unchanged. An admin can issue a time-limited verification link for a named outside party, such as a lawyer or tribunal; every issuance is logged and appears in the monthly reports. The page footer reads "Confidential internal record" next to the document ID. PUBLIC\_CUSTOMER documents keep the public verify page.

## 13. Monthly reporting architecture

Reports are generated from the insert-only ledger by a scheduled job at 02:00 UK time on the 1st of each month, so no administrator can shape what goes into them.

**Pipeline**

1. Scheduler (Inngest cron) fires `reports.monthly` per COMPANY\_MANAGED tenant.
2. Job snapshots the ledger range for the closed month (`seq` from–to) and records the range + the day's anchor hash in `report_runs` — so a report can later be proven complete.
3. Fan-out: one job per audience — Company Admin (all), each Manager (their teams), each Employee (their own documents only).
4. Aggregation SQL builds the dataset; a React-PDF template renders the PDF; the same dataset is written as CSV (UTF-8, one row per amendment change).
5. Both files are sealed (PAdES for PDF, SHA-256 for CSV), stored with Object Lock, and emailed as a secure link (not an attachment — employees' reports can contain personal data) via the transactional email provider.
6. Delivery and open events are logged; a failed email retries for 72 h, then alerts the Company Admin.

**Contents per report**

| Section | Admin | Manager | Employee |
| --- | --- | --- | --- |
| Documents created / sent / signed (counts + list) | All | Own teams | Own |
| Amendments by class, with original vs updated text | All | Own teams | Own |
| Administrator responsible, timestamp, reason | Yes | Yes | Yes |
| Consent record version relied on | Yes | Yes | Yes |
| Approval status and approver | Yes | Yes | Yes |
| Notification + acknowledgement status | Yes | Yes | Yes |
| Disputes open / resolved, corrections issued | Yes | Yes | Yes |
| Consent withdrawals | Yes | Own teams | Own |
| Ledger range + anchor hash (proof of completeness) | Yes | Yes | Yes |

Employees can also download any past month's report on demand; on-demand runs are logged as their own `report_runs` rows and never replace the scheduled one.

## 14. API specification

REST + JSON under `/api/v1`, OpenAPI 3.1 generated from Zod schemas; the tenant always comes from the session or API key, never the URL or body. Company-managed endpoints live under a separate `/api/v1/company` router that returns 404 for any PUBLIC\_CUSTOMER caller.

**Shared (both workspace types)**

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /auth/register, /auth/login, /auth/mfa/verify | Identity |
| POST | /invitations/{token}/accept | Accept any invitation |
| GET | /agreements/current?kind= | Fetch the agreement to show |
| POST | /consents | Record acceptance {agreement\_version\_id, ui\_text\_sha256} |
| POST | /documents | Create (upload URL returned) |
| POST | /documents/{id}/versions | Upload a new draft version |
| GET | /documents/{id} · /documents/{id}/versions | Read |
| POST | /envelopes | Bind version + recipients + fields |
| POST | /envelopes/{id}/send · /void · /remind | Workflow |
| GET | /sign/{signingToken} | Signer session (no account) |
| POST | /sign/{signingToken}/otp · /complete · /decline | Signing |
| GET | /documents/{id}/versions/{v}/download | Signed PDF |
| GET | /documents/{id}/versions/{v}/certificate | Certificate of completion |
| POST | /webhooks · GET /events | Integrations |

**Public verification (no auth, rate-limited)**

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /verify/{publicId}?t= | Status JSON for the verify page |
| POST | /verify/hash | {sha256} → which version, if any, matches |

**COMPANY\_MANAGED only (`/api/v1/company`)**

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /managers/invitations | Admin invites manager |
| PATCH | /managers/{id} | Suspend, change scope |
| POST | /employees/invitations | Manager invites employee |
| POST | /agreement-versions | Admin publishes new agreement/consent text |
| POST | /documents/{id}/amendments | Propose {class, reason, changes\[\]} |
| POST | /amendments/{id}/approve · /reject | Approver action (four-eyes) |
| POST | /amendments/{id}/apply | Render new version, notify employee |
| POST | /amendments/{id}/acknowledge · /dispute | Employee action |
| POST | /amendments/{id}/corrections | New correction event |
| GET | /amendments?documentId=&status= | List |
| GET | /reports?period=2027-03 · /reports/{id}/pdf · /csv | Reports |
| POST | /legal-holds | Admin places hold |

**PUBLIC\_CUSTOMER only**

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /billing/checkout · /billing/portal | Stripe |
| GET/POST | /team/members · /templates · /branding | Workspace admin |
| POST | /api-keys | Customer API access (scoped, hashed) |

Conventions: `Idempotency-Key` header on all POSTs; cursor pagination; errors as RFC 9457 problem+json; every mutating call writes an `audit_ledger` entry in the same transaction.

## 15. Security threat model

The most likely attacker is an insider with legitimate access, so controls focus on making every privileged action visible, approved and irreversible-in-history; external threats are handled with standard SaaS hardening (STRIDE below).

| # | Threat | STRIDE | Impact | Primary controls |
| --- | --- | --- | --- | --- |
| T1 | Admin amends a signed contract and presents the clean copy as the signed original | Spoofing / Repudiation | Critical | Signature never carried to new version; footer + QR on every page; upload-to-verify hash check; employee notified within 1 business day; monthly report to employee |
| T2 | Admin silently deletes or rewrites audit history | Tampering | Critical | Insert-only tables (REVOKE), hash-chained ledger, daily anchors in separate Object-Lock bucket owned by a different cloud account |
| T3 | Admin approves own material amendment | Elevation | High | Four-eyes rule enforced in DB (approver ≠ proposer); Class C requires employee re-signature anyway |
| T4 | COMPANY\_MANAGED role reaches PUBLIC\_CUSTOMER data | Info disclosure / Elevation | Critical | RLS, separate permission catalogues, separate router, trigger guard on amendments, automated cross-tenant tests in CI |
| T5 | Platform staff browse customer documents | Info disclosure | High | No content permission for staff; break-glass with customer approval, time-boxed, logged and reported to customer |
| T6 | Signing-link interception / forwarding | Spoofing | High | Single-signer tokens, email OTP before view, 30-day expiry, IP/UA logged, optional SMS OTP |
| T7 | Account takeover of manager/admin | Spoofing | High | Mandatory MFA (passkey/TOTP), session binding, new-device alerts, admin re-auth for amendments |
| T8 | Enumeration of verify URLs | Info disclosure | Medium | 128-bit token in URL, rate limiting, minimal data without token |
| T9 | Malicious PDF (JS, embedded files, parser exploits) | Tampering / DoS | High | Sanitise and re-render PDFs in an isolated worker (no network), strip JS/actions/attachments, size + page limits |
| T10 | Sealing key theft | Spoofing | Critical | Key in cloud KMS/HSM, non-exportable, signing via IAM-restricted service, key usage alerts |
| T11 | Webhook/API key abuse | Elevation | Medium | Hashed keys, scopes, HMAC-signed webhooks, per-key rate limits |
| T12 | Dispute over what employee consented to | Repudiation | High | Consent record stores hash of exact text + UI text + RFC 3161 timestamp; agreement versions immutable |
| T13 | Ransomware / data loss | DoS | High | Object Lock, point-in-time recovery (Neon PITR 7–30 days), cross-region backup, restore drills quarterly |
| T14 | Email spoofing of signing invites (phishing) | Spoofing | Medium | SPF, DKIM, DMARC p=reject; invite emails show verify instructions |

Baseline: OWASP ASVS L2, CSP + strict cookies, dependency scanning, secret scanning, annual external pen test before COMPANY\_MANAGED goes live and before public launch, SOC 2 Type I target in year 2.

## 16. UK, EU and Pakistan legal and compliance research

Simple electronic signatures with a strong audit trail are legally usable for employment documents and ordinary commercial contracts in all three jurisdictions; the real legal constraint on this product is employment law on contract variation, not e-signature law. This is research for planning, not legal advice — each item marked "counsel" needs sign-off from a qualified lawyer in that jurisdiction before launch.

**E-signature validity**

| Topic | UK (England & Wales) | EU | Pakistan |
| --- | --- | --- | --- |
| Core law | Electronic Communications Act 2000 s.7 (admissibility); UK eIDAS (retained Reg. 910/2014); common law. The [Law Commission (2019)](https://www.gov.uk/government/publications/electronic-execution-of-documents) confirmed e-signatures can execute documents, including where statute requires a signature | eIDAS Reg. 910/2014 as amended by [eIDAS 2 (Reg. 2024/1183)](https://www.esign.ai/en-US/insight/eidas-electronic-signatures), in force since 20 May 2024 | [Electronic Transactions Ordinance 2002](https://advocatetanmoy.com/electronic-transactions-ordinance-2002-pakistan/) (ETO) |
| Simple e-signature | Valid where signer intends to authenticate | Cannot be denied legal effect solely for being electronic (Art. 25(1)); evidential weight depends on the audit trail | s.7: any legal signature requirement is satisfied by an electronic signature; s.8: may be proved in any manner |
| Higher tiers | AES / QES under UK eIDAS | AES (Art. 26); QES = equivalent to handwritten (Art. 25(2)), needs a qualified trust service provider | "Advanced electronic signature" (s.2(e)) gets a presumption of authenticity and integrity (s.9); certificates via ECAC-accredited providers |
| Excluded / special | Deeds need witness formalities; wills; some land registry documents | Member-state exceptions (e.g. some real-estate, family, notarial acts) | s.31: negotiable instruments, powers of attorney, trusts, wills, contracts for sale/conveyance of immovable property |
| Retention | Business records rules; HMRC 6 years | Member-state rules | s.5–6: electronic originals/retention valid if integrity reliably assured from first generation in final form |

Product consequences: block or warn on excluded document types per jurisdiction (template category + warning); MVP offers simple signatures with OTP, hash, PAdES seal and timestamp; AES/QES via a partner QTSP (e.g. a provider on the EU Trusted List) in phase 3; Pakistan AES via an ECAC-accredited provider in phase 4 (counsel).

**Employment-law limits on the amendment feature (most important)**

- UK: contracts of employment can generally only be varied by agreement. Courts read unilateral variation clauses narrowly — [Wandsworth LBC v D'Silva](https://www.hcrlaw.com/?p=5230) requires clear language and courts avoid unreasonable results; [Norman v National Audit Office (EAT)](https://mondaq.com/uk/employment-litigation-tribunals/380520/contractual-flexibility-clauses-must-be-clear-and-unambiguous-to-give-an-employer-a-right-to-make-unilateral-changes) refused a generic "subject to amendment" clause. A wrongly imposed change risks breach-of-contract and constructive-dismissal claims.
- UK: [ERA 1996 s.4](https://www.legislation.gov.uk/ukpga/1996/18/section/4/data.html) requires a written statement of any change to the statutory particulars at the earliest opportunity and no later than one month after the change. The amendment notice + monthly report must satisfy this — design the notice to be that statement.
- Pakistan and EU member states: same principle in substance — core terms change by agreement (counsel to confirm per country and, for Pakistan, the applicable provincial standing orders).
- Design response: Class A (clerical: typos, formatting, a misspelled name) — admin applies, employee notified; Class B (administrative items the contract itself names as changeable, e.g. reporting line, office address, policy references) — notified with 14-day dispute window, consent-backed; Class C (pay, hours, duties, location beyond policy, notice, restrictive covenants, anything detrimental) — new version must be signed by the employee. The system never treats Class C as effective without that signature.

**Data protection**

| Topic | UK | EU | Pakistan |
| --- | --- | --- | --- |
| Law | UK GDPR + Data Protection Act 2018 | GDPR | No comprehensive data-protection act in force as of late 2026; the Personal Data Protection Bill remains unenacted ([status review](https://www.offlist.me/what-is-pakistan-data-protection)); PECA 2016 applies |
| Our role — public | Processor for customers (DPA required, Art. 28) | Same | Same contractually |
| Our role — company-managed | Controller for employee data | Same | Same |
| Lawful basis for employee data | Contract + legal obligation + legitimate interests — **not consent** (power imbalance makes employee consent unreliable) | Same | Contractual |
| Transfers | UK→PK needs IDTA/addendum + transfer risk assessment if Pakistan staff access data | SCCs | Draft bill proposed localisation for "critical" data — monitor |
| Retention / erasure | Retention schedule; erasure requests subject to legal-claim exemptions | Same | — |

Note the wording point: the "Employee Document Administration Consent" is a contractual agreement about document administration, not the GDPR lawful basis for processing. Privacy notices must say so.

**Other obligations**: consumer/SaaS terms and auto-renewal rules for public plans; VAT/OSS on digital services (Stripe Tax); accessibility (WCAG 2.2 AA); ICO registration fee (UK); records of processing; DPIA for the company-managed amendment system (high risk: employee monitoring and contract changes).

**"Internal use only, not for court" clause (founder decision)**

- UK: [ERA 1996 s.203](https://www.legislation.gov.uk/ukpga/1996/18/section/203) makes void any provision that tries to stop a person bringing proceedings under the Act before an employment tribunal; only formal settlement agreements with independent legal advice are excepted.
- England & Wales: since 1 October 2025, [Victims and Prisoners Act 2024 s.17](https://www.gov.uk/government/publications/victims-and-prisoners-act-2024-changes-to-non-disclosure-agreements/victims-and-prisoners-act-2024-changes-to-non-disclosure-agreements) voids confidentiality terms that stop victims of crime from reporting to the police and other listed recipients.
- Whistleblowing protection (UK; EU Whistleblower Directive) and court disclosure orders override contractual confidentiality; Pakistani and EU courts are expected to take the same view that a private contract cannot oust their jurisdiction (counsel).
- Recommendation: a confidentiality and internal-use clause with explicit legal carve-outs. It is enforceable, protects the company from public leaks, and does not look like an attempt to block employees' rights, which a tribunal would hold against the company.

**Public workspace: worldwide markets (founder decision)**

| Market | E-signature law | Typical exclusions | Product and compliance needs |
| --- | --- | --- | --- |
| United States | Federal ESIGN Act (2000) + UETA, adopted in 49 states; New York has its own statute | Wills, codicils, testamentary trusts; adoption, divorce and family law; court orders and official court papers; some UCC matters and consumer notices (e.g. utility cut-off, insurance cancellation) ([overview](https://natlawreview.com/article/know-legality-electronic-signatures)) | ESIGN consumer-disclosure consent before electronic records for consumer signers; state privacy laws (e.g. California CCPA/CPRA); US sales tax via Stripe Tax; SOC 2 expected by US business buyers |
| UK, EU, Pakistan | As in the tables above | As above | As above |
| Rest of world | Most countries follow UNCITRAL model laws; check before marketing in each | Usually wills, real estate, notarial acts, powers of attorney | Local data-residency rules in some countries; local tax registration thresholds |

Product consequences: a governing-jurisdiction setting per document that drives exclusion warnings and consent text; a US consumer consent screen; data region chosen per workspace and stored on the tenant (UK/EU at launch, US region added for M3); sanctions screening at sign-up; customer terms stating the customer is responsible for using e-signatures only where the law allows.

## 17–18. MVP roadmap and development milestones

Build the shared signing engine first, then the company workspace for internal go-live at about week 16, then public UK launch at about week 22; EU advanced signatures and Pakistan follow after launch.

&#91;embedded content: planned phases and gates · weeks from start, estimate\]

| Milestone | Weeks | Deliverables | Exit criteria |
| --- | --- | --- | --- |
| M0 Foundations | 1–3 | Repo, CI/CD, environments; auth + MFA; tenants with immutable workspace\_type; RLS on all tables; audit ledger with hash chain; S3 + KMS setup | Automated cross-tenant tests pass; ledger tamper test fails as expected |
| M1 Core signing MVP | 4–10 | PDF upload + sanitising worker; field editor; envelopes, sequential/parallel signing; email OTP; flattening; PAdES seal + timestamp; certificate of completion; verify page + upload-to-verify | A document signed by 3 parties verifies green in Adobe Reader and on the verify page; altered copy shows "no match" |
| M2 Company workspace | 11–16 | Manager and employee invitations; agreement/consent versioning; amendment classes, approvals, rendering, notifications, acknowledge/dispute; corrections; monthly reports PDF/CSV + email | Pen test 1 passed; employment counsel signs off agreement texts and the class rules; DPIA complete → internal go-live |
| M3 Public launch | 17–22 | Stripe billing + tax; plans and quotas; team roles; templates; branding; onboarding; marketing site; ToS, DPA, privacy notice | Pen test 2 passed; status page; support runbook → public UK launch |
| M4 Post-launch (months 7–12) | — | Public API + webhooks; bulk send; enterprise SSO; AES/QES via EU QTSP partner; EU marketing; Pakistan AES via ECAC-accredited provider; SOC 2 Type I prep | Driven by customer demand and counsel opinions |

The weeks are an estimate for 2–3 engineers and assume the agreement texts are drafted in parallel by counsel; a commercial PDF SDK would cut M1 by roughly 4 weeks.

Update for worldwide launch: M3 now launches UK and US together. The US data region, ESIGN consumer consent screen and US sales tax add roughly 1–2 weeks to M3; EU-specific marketing and advanced signatures stay in M4.

## 19. Hosting and operational cost estimates

Expect roughly £250–450 a month in infrastructure during development and early launch, rising to about £1,500–3,000 a month at \~500 paying workspaces; the one-off security and legal costs before launch (pen test, counsel, seal certificate) are larger than a year of hosting. All figures are approximate list-price estimates in GBP, from memory, and must be checked against current vendor pricing before budgeting.

| Item | MVP / early (≤ 50 workspaces) per month | Growth (\~500 workspaces) per month | Notes |
| --- | --- | --- | --- |
| Vercel (Pro, 2–3 seats) | £40–60 | £150–400 | Bandwidth and function usage grow with traffic |
| Neon Postgres | £15–60 | £150–400 | Scales with compute hours and storage |
| Document worker (Fargate/Fly) | £30–60 | £150–300 | 2 small always-on tasks + autoscale |
| DSS signing service | £15–30 | £50–100 | Small container |
| AWS S3 + Object Lock + backups | £5–20 | £50–150 | \~1–2 MB per signed doc, kept 7+ years |
| AWS KMS (sealing key + data keys) | £5–15 | £20–50 | Per-key + per-request |
| RFC 3161 timestamps | £0–50 | £100–300 | Often bundled with the seal certificate |
| Inngest | £0–60 | £100–200 | Free tier covers early volume |
| Postmark email | £12–40 | £80–200 | Per 10k emails |
| SMS OTP (optional) | £0–30 | £100–400 | Pay per message; varies by country |
| Sentry + logs + uptime | £20–60 | £100–250 |  |
| Better Auth / WorkOS | £0 | £0–250 | WorkOS only when enterprise SSO is sold |
| Stripe | 1.5%–2.9% + fixed fee per transaction | same | UK/EU card rates differ |
| **Monthly total (ex. Stripe fees)** | **≈ £250–450** | **≈ £1,500–3,000** |  |

**One-off and annual costs**

| Item | Approx. cost | When |
| --- | --- | --- |
| AATL document-signing (seal) certificate on HSM/KMS | £800–3,000 / year | Before public launch |
| External penetration test | £5,000–15,000 per test | Before company-managed go-live and before public launch |
| Employment + data-protection counsel (UK) | £3,000–10,000 | Agreement drafts, DPIA review, terms |
| EU and Pakistan local counsel opinions | £2,000–6,000 each | Before marketing in each market |
| Commercial PDF SDK (optional) | £5,000–30,000 / year | Only if chosen over pdf.js |
| Cyber + professional indemnity insurance | £1,500–5,000 / year | Before public launch |
| SOC 2 Type I (year 2) | £15,000–40,000 incl. tooling | When selling to larger customers |

Team assumption for the timeline in sections 17–18: 1 full-stack lead (you or a hire), 1 senior backend/security engineer, 1 part-time designer, part-time QA — about 4–6 months to public launch.

## Technology stack and open questions

Recommended: Next.js + TypeScript for the web app, a separate document-processing worker for PDF and signing, Postgres (Neon, London/EU region) with RLS, AWS S3 Object Lock + KMS for evidence, Stripe for billing. Your proposed stack is sound; the one change is moving PDF/crypto work out of serverless functions.

| Layer | Choice | Why | Alternative |
| --- | --- | --- | --- |
| Web app + API | Next.js (App Router) + TypeScript on Vercel | Fast to build, one language, good DX; route handlers for the API | Remix; NestJS API if team grows |
| Validation / API contract | Zod + OpenAPI generation | One schema for runtime checks and docs | tRPC (internal only) |
| Database | PostgreSQL on Neon (UK/EU region) | Managed, branching for previews, RLS support, PITR | AWS RDS / Supabase |
| ORM | Drizzle | Works cleanly with RLS and SQL migrations | Prisma (weaker RLS story) |
| Auth | Better Auth (self-hosted) + passkeys/TOTP; WorkOS later for enterprise SSO | Owns the session → tenant mapping we need for RLS | Clerk, Auth.js |
| Document worker | Node service on AWS Fargate (or Fly.io) running pdf-lib, qpdf, Ghostscript sandbox | Long jobs, native binaries, network-isolated sanitising | Lambda with container images |
| PAdES sealing | EU DSS (Digital Signature Service) open-source library (Java) as a small signing microservice, key in AWS KMS | Most standards-complete open-source PAdES-B-LT implementation | node-signpdf (simpler, fewer LTV features) |
| Timestamping | Commercial RFC 3161 TSA (from the same CA as the seal cert) | Third-party proof of time | Free TSAs (not for production) |
| Object storage | AWS S3 eu-west-2 with versioning + Object Lock (compliance) | WORM retention for signed originals | Backblaze B2 with Object Lock |
| Background jobs | Inngest | Durable workflows, cron for monthly reports, retries | Trigger.dev, BullMQ + Redis |
| Email | Postmark (transactional) | Deliverability, message streams, webhooks | Resend, AWS SES |
| Payments | Stripe Billing + Stripe Tax (UK entity) | Subscriptions, VAT/OSS, customer portal | Paddle (merchant of record) |
| Browser viewer | pdf.js + custom field layer (React) | Full control of field placement | Commercial SDK (Apryse, Nutrient) — faster, costly |
| Observability | Sentry + Axiom/Better Stack | Errors, logs, uptime | Datadog |
| Security tooling | GitHub Advanced Security / Snyk, Doppler or AWS Secrets Manager | Dependency + secret scanning | — |

**Open questions for you**

- [ ] Will COMPANY\_MANAGED ever be sold to other employers? If yes, it becomes a third product tier and needs its own commercial terms — the architecture already allows multiple COMPANY\_MANAGED tenants.
- [ ] Which legal entity operates the platform (UK Ltd?) and where are staff with production access located (affects UK→Pakistan transfer paperwork)?
- [ ] Approximate employee count in the company workspace, and expected documents per month?
- [ ] Do you already have an employment lawyer to draft the Manager Agreement and Employee Consent? I can produce first drafts for their review.
- [ ] Budget ceiling for a commercial PDF SDK (saves 4–6 weeks) versus building on pdf.js?
- [ ] Brand name and domain for the platform (needed for the seal certificate and email domain).

## Sources

- [Electronic Transactions Ordinance 2002 (Pakistan), full text](https://advocatetanmoy.com/electronic-transactions-ordinance-2002-pakistan/)
- [Law Commission: Electronic execution of documents (GOV.UK)](https://www.gov.uk/government/publications/electronic-execution-of-documents)
- [Employment Rights Act 1996, section 4](https://www.legislation.gov.uk/ukpga/1996/18/section/4/data.html)
- [Variation clauses: D'Silva, Hart, Norman (HCR Law)](https://www.hcrlaw.com/?p=5230)
- [Norman v National Audit Office summary (Mondaq)](https://mondaq.com/uk/employment-litigation-tribunals/380520/contractual-flexibility-clauses-must-be-clear-and-unambiguous-to-give-an-employer-a-right-to-make-unilateral-changes)
- [eIDAS Article 25 as amended by Reg. 2024/1183 (esign.ai)](https://www.esign.ai/en-US/insight/eidas-electronic-signatures)
- [Pakistan data-protection status review, Sept 2026](https://www.offlist.me/what-is-pakistan-data-protection)
