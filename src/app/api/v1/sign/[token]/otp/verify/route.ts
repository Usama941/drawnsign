import { z } from "zod";
import { readJson } from "@/server/input";
import { signingRoute } from "@/server/signing-route";
import { SignerError, signerCookie, verifyOtp } from "@/signing/signer";
import { signerErrors } from "@/signing/signer-http";

const Body = z.object({ code: z.string().regex(/^\d{6}$/) });

export const POST = signingRoute(async (s) =>
  signerErrors(async () => {
    const { code } = await readJson(s.req, Body);
    try {
      const session = await verifyOtp(s, code);
      s.audit({ action: "signer.otp_verified", objectType: "recipient", objectId: s.recipientId });
      return Response.json(
        { verified: true },
        { headers: { "set-cookie": signerCookie(session) } },
      );
    } catch (err) {
      // A wrong code must still count against the attempt limit, and be audited.
      if (err instanceof SignerError && err.status === 400) {
        s.commitEvenIfFailed();
        s.audit({ action: "signer.otp_failed", objectType: "recipient", objectId: s.recipientId });
      }
      throw err;
    }
  }),
);
