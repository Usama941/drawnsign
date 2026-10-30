import { tenantContext } from "@/auth/session";
import { findDocument, listVersions, SEND, VIEW } from "@/documents/service";
import { createUpload, uploadInfo } from "@/documents/uploads";
import { idParam } from "@/server/input";
import { notFound, problem } from "@/server/problem";
import { route } from "@/server/route";

// A new draft version starts as an upload; it becomes a version once sanitised.
export const POST = route({ permission: SEND }, async ({ tx, session, params, audit }) => {
  const doc = await findDocument(tx, session, idParam(params, "id"));
  if (!doc) return notFound();
  if (doc.status !== "DRAFT") return problem(409, "Conflict", "only drafts take new versions");
  const upload = await createUpload(tx, tenantContext(session), doc.id);
  audit({
    action: "upload.created",
    objectType: "upload",
    objectId: upload.id,
    details: { documentId: doc.id },
  });
  return Response.json({ upload: uploadInfo(upload) }, { status: 201 });
});

export const GET = route({ permission: VIEW }, async ({ tx, session, params }) => {
  const doc = await findDocument(tx, session, idParam(params, "id"));
  if (!doc) return notFound();
  return Response.json({ versions: await listVersions(tx, doc.id) });
});
