import { DevSealSigner, type SealSigner } from "@/crypto/dev-seal";
import {
  DevTimestampAuthority,
  HttpTimestampAuthority,
  type TimestampAuthority,
} from "@/crypto/tsa";
import { appBaseUrl } from "@/lib/base-url";
import { goLiveGaps } from "@/lib/go-live";
import { sealModeViolation } from "@/lib/seal-mode";
import { getStorage } from "@/storage";

export class SealUnavailableError extends Error {}

let dev: Promise<{ signer: SealSigner; tsa: TimestampAuthority }> | undefined;

// The sealer for this deployment. SEAL_MODE=development gives the in-memory development seal
// (refused on Vercel production and on PRODUCTION_HOSTNAME, checked against the app's base URL and the
// request host). Anything else needs a production KMS/HSM signer, which does not exist yet,
// so sealing refuses while goLiveGaps() is non-empty (CLAUDE.md rule 9).
export async function getSealer(
  requestHost?: string,
): Promise<{ signer: SealSigner; tsa: TimestampAuthority }> {
  const appHost = new URL(appBaseUrl()).host;
  for (const host of [requestHost, appHost]) {
    const violation = sealModeViolation(process.env, host);
    if (violation) throw new SealUnavailableError(violation);
  }
  if (process.env.SEAL_MODE === "development") {
    dev ??= (async () => ({
      signer: await DevSealSigner.create(),
      tsa: process.env.TSA_URL
        ? new HttpTimestampAuthority(process.env.TSA_URL, true)
        : await DevTimestampAuthority.create(),
    }))();
    return dev;
  }
  const gaps = goLiveGaps(getStorage(), null);
  throw new SealUnavailableError(
    `sealing refused until go-live requirements are met: ${gaps.join("; ")}`,
  );
}
