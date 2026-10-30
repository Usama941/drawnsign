import { signingRoute } from "@/server/signing-route";
import { signingView } from "@/signing/signer";
import { signerErrors } from "@/signing/signer-http";

export const GET = signingRoute(async (s) =>
  signerErrors(async () => Response.json(await signingView(s))),
);
