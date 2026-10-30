import { signingRoute } from "@/server/signing-route";
import { signingDocument } from "@/signing/signer";
import { signerErrors } from "@/signing/signer-http";
import { getStorage } from "@/storage";

export const GET = signingRoute(async (s) =>
  signerErrors(async () => {
    const bytes = await signingDocument(s, getStorage());
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }),
);
