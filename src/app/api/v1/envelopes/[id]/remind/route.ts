import { tenantContext } from "@/auth/session";
import { findDocument, SEND } from "@/documents/service";
import { idParam } from "@/server/input";
import { notFound } from "@/server/problem";
import { route } from "@/server/route";
import { getEnvelope, remindEnvelope } from "@/signing/envelopes";
import { envelopeErrors, sendAll } from "@/signing/http";

// Issues fresh links to recipients still waiting to sign (only hashes are stored, so old
// links cannot be re-sent).
export const POST = route(
  { permission: SEND },
  async ({ tx, session, params, audit, afterCommit }) =>
    envelopeErrors(async () => {
      const env = await getEnvelope(tx, idParam(params, "id"));
      if (!env || !(await findDocument(tx, session, env.documentId))) return notFound();
      const mail = await remindEnvelope(tx, tenantContext(session), env.id);
      afterCommit(sendAll(mail));
      audit({
        action: "envelope.reminded",
        objectType: "envelope",
        objectId: env.id,
        details: { reminded: mail.length },
      });
      return Response.json({ reminded: mail.length });
    }),
);
