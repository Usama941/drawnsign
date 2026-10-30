import { tenantContext } from "@/auth/session";
import { findDocument, SEND } from "@/documents/service";
import { readJson } from "@/server/input";
import { route } from "@/server/route";
import { CreateEnvelope, createEnvelope } from "@/signing/envelopes";
import { envelopeErrors } from "@/signing/http";

export const POST = route({ permission: SEND }, async ({ req, tx, session, audit }) =>
  envelopeErrors(async () => {
    const input = await readJson(req, CreateEnvelope);
    const id = await createEnvelope(tx, tenantContext(session), input, async (docId) =>
      Boolean(await findDocument(tx, session, docId)),
    );
    audit({
      action: "envelope.created",
      objectType: "envelope",
      objectId: id,
      details: {
        documentId: input.documentId,
        recipients: input.recipients.length,
        fields: input.fields.length,
      },
    });
    return Response.json({ id }, { status: 201 });
  }),
);
