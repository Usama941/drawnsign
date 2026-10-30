import { signingRoute } from "@/server/signing-route";
import { sendAll } from "@/signing/http";
import { sendOtp } from "@/signing/signer";
import { signerErrors } from "@/signing/signer-http";

export const POST = signingRoute(async (s) =>
  signerErrors(async () => {
    const mail = await sendOtp(s);
    s.afterCommit(sendAll([mail]));
    s.audit({ action: "signer.otp_sent", objectType: "recipient", objectId: s.recipientId });
    return Response.json({ sent: true }, { status: 202 });
  }),
);
