import type { Signer } from "@/crypto/signer";
import type { Storage } from "@/storage";

// Pre-go-live controls from docs/PRD.md that the running configuration does not yet meet.
// M2 go-live and any production sealing must refuse to proceed while this is non-empty.
export function goLiveGaps(storage: Storage, signer: Signer | null): string[] {
  const gaps: string[] = [];
  if (!storage.evidenceLocked) gaps.push("evidence storage has no write-once locked retention");
  if (!signer) gaps.push("no sealing key configured");
  else if (!signer.hardwareBacked) gaps.push("sealing key is not held in a KMS/HSM");
  return gaps;
}
