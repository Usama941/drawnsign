import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { appendAudit } from "@/db/audit";
import { documents, documentVersions, uploads } from "@/db/schema";
import { withTenant, type TenantContext, type Tx } from "@/db/tenant";
import { requireRow, verifyJobContext } from "@/jobs/context";
import { PdfRejectedError, sanitizePdf } from "@/pdf/sanitize";
import { objectKey, type Storage } from "@/storage";

export type UploadMode = "blob" | "direct";

// Browser uploads go straight to Vercel Blob ("blob") because Vercel functions cap request
// bodies at ~4.5 MB. Local development and tests post the bytes to the API ("direct").
export function uploadMode(): UploadMode {
  return process.env.UPLOAD_MODE === "blob" ? "blob" : "direct";
}

export function rawUploadKey(tenantId: string, uploadId: string): string {
  return objectKey(tenantId, "uploads", `${uploadId}.pdf`);
}

export async function createUpload(
  tx: Tx,
  ctx: TenantContext & { userId: string },
  documentId: string,
): Promise<{ id: string; storageKey: string }> {
  const id = randomUUID();
  const storageKey = rawUploadKey(ctx.tenantId, id);
  await tx.insert(uploads).values({
    id,
    tenantId: ctx.tenantId,
    documentId,
    storageKey,
    createdBy: ctx.userId,
  });
  return { id, storageKey };
}

export type ProcessResult =
  | { status: "ACCEPTED"; versionId: string }
  | { status: "REJECTED"; reason: string }
  | { status: "SKIPPED" };

// Sanitises an uploaded file into a new DRAFT version. Runs in a background job with the
// tenant context captured from the uploader's session; safe to retry.
export async function processUpload(
  ctx: TenantContext,
  uploadId: string,
  storage: Storage,
): Promise<ProcessResult> {
  let rawKey: string | null = null;
  const result = await withTenant(ctx, async (tx): Promise<ProcessResult> => {
    await verifyJobContext(tx, ctx);
    const [row] = await tx.select().from(uploads).where(eq(uploads.id, uploadId)).for("update");
    const upload = requireRow(row, "upload");
    if (upload.status !== "UPLOADED") return { status: "SKIPPED" };

    const raw = await storage.getDraft(upload.storageKey);
    if (raw) rawKey = upload.storageKey;
    let result: ProcessResult;
    try {
      if (!raw) throw new PdfRejectedError("malformed");
      const clean = await sanitizePdf(raw);
      const [doc] = await tx
        .select({ currentVersionId: documents.currentVersionId, status: documents.status })
        .from(documents)
        .where(eq(documents.id, upload.documentId));
      if (!doc || doc.status !== "DRAFT") throw new PdfRejectedError("malformed");

      const versionId = randomUUID();
      const key = objectKey(ctx.tenantId, "documents", upload.documentId, `${versionId}.pdf`);
      await storage.putDraft(key, clean.bytes, "application/pdf");
      await tx.insert(documentVersions).values({
        id: versionId,
        tenantId: ctx.tenantId,
        documentId: upload.documentId,
        versionNo: 0,
        parentVersionId: doc.currentVersionId,
        kind: "DRAFT",
        storageClass: "DRAFTS",
        storageKey: key,
        sha256: clean.sha256,
        sizeBytes: clean.bytes.byteLength,
        pageCount: clean.pageCount,
        createdBy: upload.createdBy,
      });
      await tx
        .update(documents)
        .set({ currentVersionId: versionId })
        .where(eq(documents.id, upload.documentId));
      await tx
        .update(uploads)
        .set({ status: "ACCEPTED", versionId, updatedAt: new Date() })
        .where(eq(uploads.id, uploadId));
      await appendAudit(tx, {
        tenantId: ctx.tenantId,
        actorId: upload.createdBy,
        action: "document.version_created",
        objectType: "document_version",
        objectId: versionId,
        payload: {
          documentId: upload.documentId,
          uploadId,
          sha256: clean.sha256,
          pages: clean.pageCount,
        },
      });
      result = { status: "ACCEPTED", versionId };
    } catch (err) {
      if (!(err instanceof PdfRejectedError)) throw err;
      await tx
        .update(uploads)
        .set({ status: "REJECTED", rejectReason: err.reason, updatedAt: new Date() })
        .where(eq(uploads.id, uploadId));
      await appendAudit(tx, {
        tenantId: ctx.tenantId,
        actorId: upload.createdBy,
        action: "document.upload_rejected",
        objectType: "upload",
        objectId: uploadId,
        payload: { documentId: upload.documentId, reason: err.reason },
      });
      result = { status: "REJECTED", reason: err.reason };
    }
    return result;
  });
  // The raw upload is never kept, whatever the outcome; deleted only after the commit.
  if (rawKey) await storage.deleteDraft(rawKey);
  return result;
}
