import { findOwnUpload, SEND } from "@/documents/service";
import { idParam } from "@/server/input";
import { notFound } from "@/server/problem";
import { route } from "@/server/route";

export const GET = route({ permission: SEND }, async ({ tx, session, params }) => {
  const upload = await findOwnUpload(tx, session, idParam(params, "id"));
  if (!upload) return notFound();
  return Response.json({
    id: upload.id,
    documentId: upload.documentId,
    status: upload.status,
    rejectReason: upload.rejectReason,
    versionId: upload.versionId,
  });
});
