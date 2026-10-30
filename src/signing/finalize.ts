import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { appendAudit } from "@/db/audit";
import { documents, documentVersions, envelopes, fields, tenants } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import { requireRow, verifyJobContext } from "@/jobs/context";
import { flattenFields, type FilledField } from "@/pdf/flatten";
import { objectKey, type Storage } from "@/storage";

// After the last signature: draws all values onto the frozen SENT version and stores the
// result as a new SIGNED version (insert-only) in the evidence store. Idempotent.
export async function finalizeEnvelope(
  ctx: TenantContext,
  envelopeId: string,
  storage: Storage,
): Promise<{ signedVersionId: string } | { skipped: true }> {
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
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId));
    const source = requireRow(sent, "version");
    const bytes = await storage.getEvidence(source.storageKey, source.sha256);
    if (!bytes) throw new Error(`evidence missing for version ${source.id}`);

    const filled = await tx
      .select()
      .from(fields)
      .where(and(eq(fields.envelopeId, env.id), isNotNull(fields.value)));
    const signed = await flattenFields(
      bytes,
      filled.map((f): FilledField => ({ ...f, value: f.value! })),
    );
    const sha256 = createHash("sha256").update(signed).digest("hex");

    const id = randomUUID();
    const key = objectKey(ctx.tenantId, "documents", env.documentId, `${id}.pdf`);
    const retainUntil = new Date(
      Date.now() + requireRow(tenant, "tenant").retentionYears * 365.25 * 86_400_000,
    );
    await storage.putEvidence(key, signed, "application/pdf", retainUntil);
    await tx.insert(documentVersions).values({
      id,
      tenantId: ctx.tenantId,
      documentId: env.documentId,
      versionNo: 0,
      parentVersionId: source.id,
      kind: "SIGNED",
      storageClass: "EVIDENCE",
      storageKey: key,
      sha256,
      sizeBytes: signed.byteLength,
      pageCount: source.pageCount,
      createdBy: null,
    });
    await tx.update(envelopes).set({ signedVersionId: id }).where(eq(envelopes.id, env.id));
    await tx
      .update(documents)
      .set({ currentVersionId: id })
      .where(eq(documents.id, env.documentId));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: null,
      action: "document.signed_version_created",
      objectType: "document_version",
      objectId: id,
      payload: { envelopeId: env.id, sourceVersionId: source.id, sha256, fields: filled.length },
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
