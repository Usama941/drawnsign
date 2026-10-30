import { tenantContext } from "@/auth/session";
import { findDocument, SEND } from "@/documents/service";
import { idParam } from "@/server/input";
import { notFound } from "@/server/problem";
import { route } from "@/server/route";
import { getEnvelope, sendEnvelope } from "@/signing/envelopes";
import { envelopeErrors, sendAll } from "@/signing/http";
import { getStorage } from "@/storage";

export const POST = route(
  { permission: SEND },
  async ({ tx, session, params, audit, afterCommit }) =>
    envelopeErrors(async () => {
      const env = await getEnvelope(tx, idParam(params, "id"));
      if (!env || !(await findDocument(tx, session, env.documentId))) return notFound();
      const mail = await sendEnvelope(tx, tenantContext(session), env.id, getStorage());
      afterCommit(sendAll(mail));
      audit({
        action: "envelope.sent",
        objectType: "envelope",
        objectId: env.id,
        details: { notified: mail.length },
      });
      return Response.json({ id: env.id, status: "SENT" });
    }),
);
