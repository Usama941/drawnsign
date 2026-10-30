import { enqueueEnvelopeCompleted } from "@/inngest/signing";
import { readJson } from "@/server/input";
import { signingRoute } from "@/server/signing-route";
import { sendAll } from "@/signing/http";
import { CompleteBody, completeSigning } from "@/signing/signer";
import { signerErrors } from "@/signing/signer-http";

export const POST = signingRoute(async (s) =>
  signerErrors(async () => {
    const input = await readJson(s.req, CompleteBody);
    const result = await completeSigning(s, input);
    s.afterCommit(sendAll(result.mail));
    if (result.envelopeCompleted) {
      s.afterCommit(() => enqueueEnvelopeCompleted({ ctx: s.tenant, envelopeId: s.envelopeId }));
    }
    s.audit({
      action: "signer.signed",
      objectType: "recipient",
      objectId: s.recipientId,
      details: { envelopeId: s.envelopeId, envelopeCompleted: result.envelopeCompleted },
    });
    return Response.json({ signed: true, envelopeCompleted: result.envelopeCompleted });
  }),
);
