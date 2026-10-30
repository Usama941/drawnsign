import type { SealCheck } from "@/crypto/pades";

export type Verdict =
  // Green: a version that was itself signed, sealed with a production key, all checks pass.
  | "SIGNED_TRUSTED"
  // Amber: signed and intact, but sealed with the untrusted development seal.
  | "SIGNED_DEVELOPMENT"
  // Red: claims to be signed but a check fails.
  | "SIGNATURE_INVALID"
  // Grey: this version was not itself signed (draft, sent, amended, correction).
  | "NOT_SIGNED";

// CLAUDE.md rule 8: only a version that was itself signed can ever be green, and only with
// a production seal whose checks all pass.
export function verdictFor(
  kind: string,
  sealMode: "DEVELOPMENT" | "PRODUCTION" | null,
  check: SealCheck | null,
): Verdict {
  if (kind !== "SIGNED") return "NOT_SIGNED";
  const intact =
    !!check &&
    check.signed &&
    check.coversWholeFile &&
    check.digestValid &&
    check.signatureValid &&
    check.timestampValid;
  if (!intact) return "SIGNATURE_INVALID";
  return sealMode === "PRODUCTION" ? "SIGNED_TRUSTED" : "SIGNED_DEVELOPMENT";
}
