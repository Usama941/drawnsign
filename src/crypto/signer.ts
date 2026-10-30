import { createHash, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";

// Provider-neutral sealing interface. Production signing must use a key held in a cloud
// KMS/HSM that never leaves it (CLAUDE.md rule 9); until one is configured there is no
// production signer at all (pre-go-live requirement in docs/PRD.md).
export interface Signer {
  readonly keyId: string;
  readonly algorithm: "ECDSA_P256_SHA256";
  // True only for keys generated and held in hardware (KMS/HSM).
  readonly hardwareBacked: boolean;
  // Signs sha256(data). Returns a DER-encoded ECDSA signature.
  sign(data: Uint8Array): Promise<Uint8Array>;
  publicKeyPem(): Promise<string>;
}

export function verifySignature(publicKeyPem: string, data: Uint8Array, signature: Uint8Array) {
  return verify("sha256", data, publicKeyPem, signature);
}

// Test-only signer. The key pair is generated in memory per instance; nothing is persisted,
// logged or committed. Refuses to exist outside NODE_ENV=test.
export class FakeSigner implements Signer {
  readonly algorithm = "ECDSA_P256_SHA256";
  readonly hardwareBacked = false;
  readonly keyId: string;
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  constructor() {
    if (process.env.NODE_ENV !== "test") throw new Error("FakeSigner is test-only");
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
    const spki = this.publicKey.export({ type: "spki", format: "der" });
    this.keyId = `fake:${createHash("sha256").update(spki).digest("hex").slice(0, 16)}`;
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(sign("sha256", data, this.privateKey));
  }

  async publicKeyPem(): Promise<string> {
    return this.publicKey.export({ type: "spki", format: "pem" }).toString();
  }
}

let signer: Signer | undefined;

export function getSigner(): Signer {
  if (!signer) {
    throw new Error(
      "No sealing key configured. A hardware-held KMS/HSM signer is a pre-go-live requirement.",
    );
  }
  return signer;
}

export function setSignerForTests(s: Signer): void {
  if (process.env.NODE_ENV !== "test") throw new Error("setSignerForTests is test-only");
  signer = s;
}
