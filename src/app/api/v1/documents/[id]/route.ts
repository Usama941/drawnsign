import { findDocument, VIEW } from "@/documents/service";
import { idParam } from "@/server/input";
import { notFound } from "@/server/problem";
import { route } from "@/server/route";

export const GET = route({ permission: VIEW }, async ({ tx, session, params }) => {
  const doc = await findDocument(tx, session, idParam(params, "id"));
  if (!doc) return notFound();
  return Response.json({
    id: doc.id,
    publicId: doc.publicId,
    title: doc.title,
    status: doc.status,
    currentVersionId: doc.currentVersionId,
    legalHold: doc.legalHold,
    createdAt: doc.createdAt,
  });
});
