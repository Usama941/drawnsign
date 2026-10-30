import { eq } from "drizzle-orm";
import { tenantContext } from "@/auth/session";
import { uploads } from "@/db/schema";
import { findOwnUpload, SEND } from "@/documents/service";
import { enqueueUploadProcessing } from "@/inngest/documents";
import { idParam } from "@/server/input";
import { notFound } from "@/server/problem";
import { route } from "@/server/route";

// The browser has finished sending the bytes; sanitising runs after this request commits.
export const POST = route(
  { permission: SEND },
  async ({ tx, session, params, audit, afterCommit }) => {
    const upload = await findOwnUpload(tx, session, idParam(params, "id"));
    if (!upload || upload.status !== "PENDING") return notFound();
    await tx
      .update(uploads)
      .set({ status: "UPLOADED", updatedAt: new Date() })
      .where(eq(uploads.id, upload.id));
    audit({ action: "upload.completed", objectType: "upload", objectId: upload.id });
    const ctx = tenantContext(session);
    afterCommit(() => enqueueUploadProcessing({ ctx, uploadId: upload.id }));
    return Response.json({ id: upload.id, status: "UPLOADED" }, { status: 202 });
  },
);
