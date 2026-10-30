import { signingRoute } from "@/server/signing-route";
import { consent } from "@/signing/signer";
import { signerErrors } from "@/signing/signer-http";

export const POST = signingRoute(async (s) =>
  signerErrors(async () => {
    await consent(s);
    s.audit({ action: "signer.consented", objectType: "recipient", objectId: s.recipientId });
    return Response.json({ consented: true });
  }),
);
