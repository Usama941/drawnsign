import { z } from "zod";
import { readJson } from "@/server/input";
import { signingRoute } from "@/server/signing-route";
import { sendAll } from "@/signing/http";
import { declineSigning } from "@/signing/signer";
import { signerErrors } from "@/signing/signer-http";

const Body = z.object({ reason: z.string().trim().min(1).max(500) });

export const POST = signingRoute(async (s) =>
  signerErrors(async () => {
    const { reason } = await readJson(s.req, Body);
    const mail = await declineSigning(s, reason);
    s.afterCommit(sendAll(mail));
    s.audit({
      action: "signer.declined",
      objectType: "recipient",
      objectId: s.recipientId,
      details: { reason },
    });
    return Response.json({ declined: true });
  }),
);
