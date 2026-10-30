import { z } from "zod";
import { findDocument } from "@/documents/service";
import { idParam, readJson } from "@/server/input";
import { notFound } from "@/server/problem";
import { route } from "@/server/route";
import { getEnvelope, voidEnvelope } from "@/signing/envelopes";
import { envelopeErrors } from "@/signing/http";

const Body = z.object({ reason: z.string().trim().min(1).max(500) });

export const POST = route(
  {
    permission: {
      PUBLIC_CUSTOMER: "customer.envelopes.void",
      COMPANY_MANAGED: "company.documents.send",
    },
  },
  async ({ req, tx, session, params, audit }) =>
    envelopeErrors(async () => {
      const { reason } = await readJson(req, Body);
      const env = await getEnvelope(tx, idParam(params, "id"));
      if (!env || !(await findDocument(tx, session, env.documentId))) return notFound();
      await voidEnvelope(tx, env.id, reason);
      audit({
        action: "envelope.voided",
        objectType: "envelope",
        objectId: env.id,
        details: { reason },
      });
      return Response.json({ id: env.id, status: "VOIDED" });
    }),
);
