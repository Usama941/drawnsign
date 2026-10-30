import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { appendAudit } from "@/db/audit";
import {
  completionCertificates,
  documents,
  documentVersions,
  envelopes,
  fields,
  recipients,
  signatureEvents,
  tenants,
} from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import { requireRow, verifyJobContext } from "@/jobs/context";
import { sealPdf, verifyPades } from "@/crypto/pades";
import { derToPem } from "@/crypto/pki";
import { buildCertificate } from "@/pdf/certificate";
import { flattenFields, type FilledField } from "@/pdf/flatten";
import { drawFooter, stripFooter } from "@/pdf/footer";
import { objectKey, type Storage } from "@/storage";
import { getSealer } from "./sealer";
import {
  displayUrl,
  insertVerificationToken,
  newToken,
  nextVersionNo,
  retentionUntil,
  verifyUrl,
} from "./versions";

// After the last signature: draws all values onto the frozen SENT version, replaces its
// footer with the SIGNED footer, seals it (PAdES-B-T) and stores it as a new SIGNED version
// (insert-only) in the evidence store; then builds and seals the certificate of completion.
// Idempotent. Refuses to run while sealing is unavailable (CLAUDE.md rule 9).
export async function finalizeEnvelope(
  ctx: TenantContext,
  envelopeId: string,
  storage: Storage,
): Promise<{ signedVersionId: string } | { skipped: true }> {
  const { signer, tsa } = await getSealer();
  const development = signer.sealMode === "DEVELOPMENT";

  return withTenant(ctx, async (tx) => {
    await verifyJobContext(tx, ctx);
    const [row] = await tx
      .select()
      .from(envelopes)
      .where(eq(envelopes.id, envelopeId))
      .for("update");
    const env = requireRow(row, "envelope");
    if (env.status !== "COMPLETED" || env.signedVersionId) return { skipped: true };

    const [sent] = await tx
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, env.documentVersionId));
    const [docRow] = await tx.select().from(documents).where(eq(documents.id, env.documentId));
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId));
    const source = requireRow(sent, "version");
    const doc = requireRow(docRow, "document");
    const bytes = await storage.getEvidence(source.storageKey, source.sha256);
    if (!bytes) throw new Error(`evidence missing for version ${source.id}`);

    const filled = await tx
      .select()
      .from(fields)
      .where(and(eq(fields.envelopeId, env.id), isNotNull(fields.value)));
    // Remove the SENT footer (not just cover it), then draw values and the SIGNED footer.
    const flattened = await flattenFields(
      await stripFooter(bytes),
      filled.map((f): FilledField => ({ ...f, value: f.value! })),
    );

    const versionNo = await nextVersionNo(tx, doc.id);
    const token = newToken();
    const url = verifyUrl(doc.publicId, token);
    const withFooter = await drawFooter(flattened, {
      publicId: doc.publicId,
      versionNo,
      status: "Signed",
      verifyUrl: url,
      displayUrl: displayUrl(doc.publicId),
      development,
    });
    const sealed = await sealPdf(withFooter, {
      signer,
      tsa,
      reason: `Completed: ${doc.publicId} version ${versionNo}`,
    });
    const check = await verifyPades(sealed);
    if (
      !check.coversWholeFile ||
      !check.digestValid ||
      !check.signatureValid ||
      !check.timestampValid
    ) {
      throw new Error("sealed document failed its own verification");
    }
    const sha256 = createHash("sha256").update(sealed).digest("hex");
    const sealCertificate = derToPem(await signer.certificateDer());
    const sealedAt = new Date();

    const id = randomUUID();
    const retainUntil = await retentionUntil(tx, ctx.tenantId);
    const key = objectKey(ctx.tenantId, "documents", doc.id, `${id}.pdf`);
    await storage.putEvidence(key, sealed, "application/pdf", retainUntil);
    const [inserted] = await tx
      .insert(documentVersions)
      .values({
        id,
        tenantId: ctx.tenantId,
        documentId: doc.id,
        versionNo: 0,
        parentVersionId: source.id,
        kind: "SIGNED",
        storageClass: "EVIDENCE",
        storageKey: key,
        sha256,
        sizeBytes: sealed.byteLength,
        pageCount: source.pageCount,
        createdBy: null,
        sealMode: signer.sealMode,
        sealCertificate,
        sealedAt,
        timestampAt: check.timestampTime,
      })
      .returning({ versionNo: documentVersions.versionNo });
    if (inserted?.versionNo !== versionNo) throw new Error("version number changed while sealing");
    await insertVerificationToken(tx, ctx, doc.id, id, token, retainUntil);
    await tx.update(envelopes).set({ signedVersionId: id }).where(eq(envelopes.id, env.id));
    await tx.update(documents).set({ currentVersionId: id }).where(eq(documents.id, doc.id));

    // Certificate of completion, sealed the same way.
    const people = await tx.select().from(recipients).where(eq(recipients.envelopeId, env.id));
    const events = await tx
      .select()
      .from(signatureEvents)
      .where(eq(signatureEvents.envelopeId, env.id))
      .orderBy(asc(signatureEvents.ts));
    const certificate = await buildCertificate({
      publicId: doc.publicId,
      title: doc.title,
      signedVersionNo: versionNo,
      signedSha256: sha256,
      sentSha256: source.sha256,
      sentAt: env.sentAt,
      completedAt: env.completedAt,
      issuer: requireRow(tenant, "tenant").name,
      signers: people.map((p) => ({
        name: p.name,
        email: p.email,
        routingOrder: p.routingOrder,
        events: events
          .filter((e) => e.recipientId === p.id)
          .map((e) => ({
            type: e.type,
            at: e.ts,
            ip: e.ip,
            userAgent: e.userAgent,
            authMethod: e.authMethod,
          })),
      })),
    });
    const certSealed = await sealPdf(
      await drawFooter(certificate, {
        publicId: doc.publicId,
        versionNo,
        status: `Certificate of completion for version ${versionNo}`,
        verifyUrl: url,
        displayUrl: displayUrl(doc.publicId),
        development,
      }),
      { signer, tsa, reason: `Certificate of completion: ${doc.publicId} version ${versionNo}` },
    );
    const certId = randomUUID();
    const certKey = objectKey(ctx.tenantId, "certificates", doc.id, `${certId}.pdf`);
    await storage.putEvidence(certKey, certSealed, "application/pdf", retainUntil);
    await tx.insert(completionCertificates).values({
      id: certId,
      tenantId: ctx.tenantId,
      documentId: doc.id,
      documentVersionId: id,
      envelopeId: env.id,
      storageKey: certKey,
      sha256: createHash("sha256").update(certSealed).digest("hex"),
      sealMode: signer.sealMode,
      sealCertificate,
      sealedAt: new Date(),
    });

    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: null,
      action: "document.signed_version_sealed",
      objectType: "document_version",
      objectId: id,
      payload: {
        envelopeId: env.id,
        sourceVersionId: source.id,
        sha256,
        sealMode: signer.sealMode,
        certificateId: certId,
      },
    });
    return { signedVersionId: id };
  });
}

export async function expireEnvelope(ctx: TenantContext, envelopeId: string): Promise<boolean> {
  return withTenant(ctx, async (tx) => {
    await verifyJobContext(tx, ctx);
    const [row] = await tx
      .select()
      .from(envelopes)
      .where(eq(envelopes.id, envelopeId))
      .for("update");
    const env = requireRow(row, "envelope");
    if (env.status !== "SENT" || env.expiresAt > new Date()) return false;
    await tx.update(envelopes).set({ status: "EXPIRED" }).where(eq(envelopes.id, env.id));
    await tx.update(documents).set({ status: "EXPIRED" }).where(eq(documents.id, env.documentId));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: null,
      action: "envelope.expired",
      objectType: "envelope",
      objectId: env.id,
    });
    return true;
  });
}
