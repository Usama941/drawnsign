import { and, asc, desc, eq, gt } from "drizzle-orm";
import { scopeOf } from "@/auth/permissions";
import type { AppSession } from "@/auth/session";
import { verifyPades, type SealCheck } from "@/crypto/pades";
import { documents, documentVersions, envelopes, recipients, tenants } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import type { VerifyMatch } from "@/db/verify-lookup";
import { maskName } from "@/pdf/certificate";
import type { Storage } from "@/storage";
import { verdictFor, type Verdict } from "./verdict";

export type VerifyView =
  | { exists: boolean; restricted?: undefined }
  | { exists: true; restricted: true; confidential: true }
  | {
      exists: true;
      restricted: false;
      document: { publicId: string; issuer: string };
      version: { number: number; kind: string; createdAt: Date };
      verdict: Verdict;
      development: boolean;
      seal: {
        mode: string;
        sealedAt: Date | null;
        timestampAt: Date | null;
        subject: string | null;
        checks: Pick<
          SealCheck,
          "coversWholeFile" | "digestValid" | "signatureValid" | "timestampValid"
        >;
      } | null;
      signers: { name: string; signedAt: Date | null }[];
      later: { latestVersion: number; latestSignedVersion: number | null };
      amendments: { count: number };
    };

async function loadContext(tx: Tx, match: VerifyMatch) {
  const [version] = await tx
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, match.versionId));
  const [doc] = await tx.select().from(documents).where(eq(documents.id, match.documentId));
  const [tenant] = await tx
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, match.tenantId));
  if (!version || !doc || !tenant) return null;
  return { version, doc, tenant };
}

// PRD section 12, private verification for COMPANY_MANAGED documents: only an in-scope
// admin, auditor or manager of that tenant, or one of the document's own signers.
async function mayViewCompanyRecord(
  tx: Tx,
  viewer: AppSession | null,
  match: VerifyMatch,
  ownerId: string,
): Promise<boolean> {
  if (!viewer?.tenant || viewer.tenant.tenantId !== match.tenantId) return false;
  const scope = scopeOf(viewer, "company.documents.view");
  if (scope === "all") return true;
  if (scope === "team") return ownerId === viewer.userId;
  if (scope === "own") {
    const rows = await tx
      .select({ id: recipients.id })
      .from(recipients)
      .innerJoin(envelopes, eq(envelopes.id, recipients.envelopeId))
      .where(
        and(
          eq(envelopes.documentId, match.documentId),
          eq(recipients.email, viewer.email.toLowerCase()),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
  return false;
}

// Public fields only (PRD section 12): no content, amendment text, reasons or admin names.
export async function verificationView(
  tx: Tx,
  match: VerifyMatch,
  viewer: AppSession | null,
  storage: Storage,
): Promise<VerifyView> {
  const ctx = await loadContext(tx, match);
  if (!ctx) return { exists: false };
  const { version, doc, tenant } = ctx;
  if (
    match.workspaceType === "COMPANY_MANAGED" &&
    !(await mayViewCompanyRecord(tx, viewer, match, doc.ownerId))
  ) {
    return { exists: true, restricted: true, confidential: true };
  }

  let check: SealCheck | null = null;
  if (version.kind === "SIGNED") {
    const bytes = await storage.getEvidence(version.storageKey, version.sha256).catch(() => null);
    check = bytes ? await verifyPades(bytes) : null;
  }
  const verdict = verdictFor(version.kind, version.sealMode, check);

  const signers =
    version.kind === "SIGNED"
      ? await tx
          .select({
            name: recipients.name,
            signedAt: recipients.completedAt,
            order: recipients.routingOrder,
          })
          .from(recipients)
          .innerJoin(envelopes, eq(envelopes.id, recipients.envelopeId))
          .where(eq(envelopes.signedVersionId, version.id))
          .orderBy(asc(recipients.routingOrder))
      : [];

  const [latest] = await tx
    .select({ n: documentVersions.versionNo })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, doc.id))
    .orderBy(desc(documentVersions.versionNo))
    .limit(1);
  const [latestSigned] = await tx
    .select({ n: documentVersions.versionNo })
    .from(documentVersions)
    .where(and(eq(documentVersions.documentId, doc.id), eq(documentVersions.kind, "SIGNED")))
    .orderBy(desc(documentVersions.versionNo))
    .limit(1);

  return {
    exists: true,
    restricted: false,
    document: { publicId: doc.publicId, issuer: tenant.name },
    version: { number: version.versionNo, kind: version.kind, createdAt: version.createdAt },
    verdict,
    development: version.sealMode === "DEVELOPMENT",
    seal: version.sealMode
      ? {
          mode: version.sealMode,
          sealedAt: version.sealedAt,
          timestampAt: version.timestampAt,
          subject: check?.subject ?? null,
          checks: {
            coversWholeFile: check?.coversWholeFile ?? false,
            digestValid: check?.digestValid ?? false,
            signatureValid: check?.signatureValid ?? false,
            timestampValid: check?.timestampValid ?? false,
          },
        }
      : null,
    signers: signers.map((s) => ({ name: maskName(s.name), signedAt: s.signedAt })),
    later: {
      latestVersion: latest?.n ?? version.versionNo,
      latestSignedVersion: latestSigned?.n ?? null,
    },
    amendments: { count: 0 },
  };
}

export type HashResult =
  | { restricted: true }
  | { match: false }
  | { match: true; versionNo: number; signed: boolean; development: boolean; thisVersion: boolean };

// Upload-to-verify: the browser sends only the SHA-256. Compared against this document's
// versions only (the document the verifier's token belongs to).
export async function hashCheck(
  tx: Tx,
  match: VerifyMatch,
  viewer: AppSession | null,
  sha256: string,
): Promise<HashResult> {
  const ctx = await loadContext(tx, match);
  if (!ctx) return { match: false };
  if (
    match.workspaceType === "COMPANY_MANAGED" &&
    !(await mayViewCompanyRecord(tx, viewer, match, ctx.doc.ownerId))
  ) {
    return { restricted: true };
  }
  const rows = await tx
    .select({
      id: documentVersions.id,
      versionNo: documentVersions.versionNo,
      kind: documentVersions.kind,
      sealMode: documentVersions.sealMode,
    })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, match.documentId),
        eq(documentVersions.sha256, sha256),
        gt(documentVersions.versionNo, 0),
      ),
    )
    .orderBy(desc(documentVersions.versionNo));
  // Prefer a signed match; DRAFT and its SENT copy never share bytes once the footer exists.
  const best = rows.find((r) => r.kind === "SIGNED") ?? rows[0];
  if (!best) return { match: false };
  return {
    match: true,
    versionNo: best.versionNo,
    signed: best.kind === "SIGNED",
    development: best.sealMode === "DEVELOPMENT",
    thisVersion: best.id === match.versionId,
  };
}
