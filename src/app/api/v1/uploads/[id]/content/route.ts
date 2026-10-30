import { findOwnUpload, SEND } from "@/documents/service";
import { uploadMode } from "@/documents/uploads";
import { PDF_LIMITS } from "@/pdf/sanitize";
import { idParam } from "@/server/input";
import { notFound, problem } from "@/server/problem";
import { route } from "@/server/route";
import { getStorage } from "@/storage";

// Direct upload of the raw bytes (local development and tests). On Vercel, browsers upload
// straight to Blob instead, via /api/v1/uploads/token.
export const PUT = route({ permission: SEND }, async ({ req, tx, session, params, audit }) => {
  if (uploadMode() !== "direct") return notFound();
  const upload = await findOwnUpload(tx, session, idParam(params, "id"));
  if (!upload || upload.status !== "PENDING") return notFound();

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > PDF_LIMITS.maxBytes) return problem(413, "Payload Too Large");
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength === 0) return problem(400, "Bad Request", "empty body");
  if (body.byteLength > PDF_LIMITS.maxBytes) return problem(413, "Payload Too Large");

  await getStorage().putDraft(upload.storageKey, body, "application/pdf");
  audit({
    action: "upload.content_received",
    objectType: "upload",
    objectId: upload.id,
    details: { bytes: body.byteLength },
  });
  return new Response(null, { status: 204 });
});
