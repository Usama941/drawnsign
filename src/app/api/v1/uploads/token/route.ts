import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { z } from "zod";
import { findOwnUpload, SEND } from "@/documents/service";
import { uploadMode } from "@/documents/uploads";
import { PDF_LIMITS } from "@/pdf/sanitize";
import { readJson } from "@/server/input";
import { notFound, problem } from "@/server/problem";
import { route } from "@/server/route";

const Body = z.object({ type: z.string() }).passthrough();

// Issues a Vercel Blob client-upload token for one pending upload. The token only allows a
// PDF of at most 25 MB at that upload's own path under the session tenant's prefix.
export const POST = route({ permission: SEND }, async ({ req, tx, session, audit }) => {
  if (uploadMode() !== "blob") return notFound();
  const body = (await readJson(req, Body)) as unknown as HandleUploadBody;
  if (body.type !== "blob.generate-client-token") return problem(400, "Bad Request");

  const token = process.env.BLOB_DRAFTS_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN;
  let uploadId: string | null = null;
  try {
    const result = await handleUpload({
      body,
      request: req,
      token,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const id = z.uuid().safeParse(clientPayload);
        const upload = id.success ? await findOwnUpload(tx, session, id.data) : null;
        if (!upload || upload.status !== "PENDING" || pathname !== `drafts/${upload.storageKey}`) {
          throw new Error("upload not allowed");
        }
        uploadId = upload.id;
        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: PDF_LIMITS.maxBytes,
          addRandomSuffix: false,
          allowOverwrite: false,
          validUntil: Date.now() + 15 * 60_000,
          tokenPayload: upload.id,
        };
      },
    });
    audit({ action: "upload.token_issued", objectType: "upload", objectId: uploadId });
    return Response.json(result);
  } catch {
    return notFound();
  }
});
