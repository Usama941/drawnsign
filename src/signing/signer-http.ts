import { problem } from "@/server/problem";
import { SignerError } from "./signer";

export async function signerErrors(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SignerError) return problem(err.status, "Signing error", err.message);
    throw err;
  }
}
