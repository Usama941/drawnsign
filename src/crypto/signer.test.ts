import { describe, expect, it, vi } from "vitest";
import { MemoryObjectStore } from "@/storage/memory-store";
import { Storage } from "@/storage";
import { goLiveGaps } from "@/lib/go-live";
import { FakeSigner, getSigner, verifySignature } from "./signer";

describe("Signer", () => {
  it("FakeSigner signs sha256(data) and verifies with its public key", async () => {
    const signer = new FakeSigner();
    const data = new TextEncoder().encode("document bytes");
    const sig = await signer.sign(data);
    const pem = await signer.publicKeyPem();
    expect(verifySignature(pem, data, sig)).toBe(true);
    expect(verifySignature(pem, new TextEncoder().encode("altered"), sig)).toBe(false);
    expect(signer.hardwareBacked).toBe(false);
  });

  it("FakeSigner refuses to run outside tests", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => new FakeSigner()).toThrow(/test-only/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("there is no production signer until a KMS/HSM key is configured", () => {
    expect(() => getSigner()).toThrow(/pre-go-live/);
  });
});

describe("goLiveGaps", () => {
  it("lists unlocked evidence storage and a non-hardware or missing key", () => {
    const dev = new Storage(new MemoryObjectStore(), new MemoryObjectStore());
    expect(goLiveGaps(dev, null)).toEqual([
      "evidence storage has no write-once locked retention",
      "no sealing key configured",
    ]);
    expect(goLiveGaps(dev, new FakeSigner())).toContain("sealing key is not held in a KMS/HSM");
  });

  it("is empty only with locked storage and a hardware-backed key", () => {
    const prod = new Storage(new MemoryObjectStore(), new MemoryObjectStore(true));
    const hsm = { ...new FakeSigner(), hardwareBacked: true } as never;
    expect(goLiveGaps(prod, hsm)).toEqual([]);
  });
});
