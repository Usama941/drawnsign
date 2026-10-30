import { createHash, KeyObject, sign, webcrypto } from "node:crypto";
import { pki } from "./pki";
import type { Signer } from "./signer";

export const DEV_SEAL_CN = "drawnsign DEVELOPMENT SEAL - NOT TRUSTED";

// A signer that can also present its X.509 certificate (needed for CMS/PAdES).
export interface SealSigner extends Signer {
  readonly sealMode: "DEVELOPMENT" | "PRODUCTION";
  certificateDer(): Promise<Uint8Array>;
}

// Development seal (CLAUDE.md rule 9): a P-256 key pair generated in memory per server
// instance with a self-signed certificate. Never stored, logged or committed; its CN says it
// is not trusted. Only used under SEAL_MODE=development while goLiveGaps() is non-empty.
export class DevSealSigner implements SealSigner {
  readonly algorithm = "ECDSA_P256_SHA256";
  readonly hardwareBacked = false;
  readonly sealMode = "DEVELOPMENT";
  private constructor(
    readonly keyId: string,
    private readonly privateKey: KeyObject,
    private readonly publicPem: string,
    private readonly certDer: Uint8Array,
  ) {}

  static async create(commonName = DEV_SEAL_CN, extendedKeyUsage?: string): Promise<DevSealSigner> {
    const { x509 } = pki();
    const keys = (await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const now = Date.now();
    const extensions: InstanceType<typeof x509.Extension>[] = [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.nonRepudiation,
        true,
      ),
    ];
    if (extendedKeyUsage)
      extensions.push(new x509.ExtendedKeyUsageExtension([extendedKeyUsage], true));
    const cert = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: createHash("sha256")
        .update(String(now) + Math.random())
        .digest("hex")
        .slice(0, 16),
      name: `CN=${commonName}, O=drawnsign (development only)`,
      notBefore: new Date(now - 60_000),
      notAfter: new Date(now + 5 * 365 * 86_400_000),
      signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
      keys,
      extensions,
    });
    const der = new Uint8Array(cert.rawData);
    const keyId = `dev:${createHash("sha256").update(der).digest("hex").slice(0, 16)}`;
    const publicPem = KeyObject.from(keys.publicKey)
      .export({ type: "spki", format: "pem" })
      .toString();
    return new DevSealSigner(keyId, KeyObject.from(keys.privateKey), publicPem, der);
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(sign("sha256", data, this.privateKey));
  }

  async publicKeyPem(): Promise<string> {
    return this.publicPem;
  }

  async certificateDer(): Promise<Uint8Array> {
    return this.certDer;
  }
}
