import { findDocument, VIEW } from "@/documents/service";
import { idParam } from "@/server/input";
import { notFound } from "@/server/problem";
import { route } from "@/server/route";
import { getEnvelope } from "@/signing/envelopes";

export const GET = route({ permission: VIEW }, async ({ tx, session, params }) => {
  const env = await getEnvelope(tx, idParam(params, "id"));
  if (!env || !(await findDocument(tx, session, env.documentId))) return notFound();
  return Response.json(env);
});
