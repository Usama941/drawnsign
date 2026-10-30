import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

// A minimal software WebAuthn authenticator (P-256, "none" attestation) for tests.
const b64url = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest();

type Cbor = number | string | Buffer | Cbor[] | Map<Cbor, Cbor> | { [k: string]: Cbor };

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  const b = Buffer.alloc(3);
  b[0] = (major << 5) | 25;
  b.writeUInt16BE(n, 1);
  return b;
}

function cbor(v: Cbor): Buffer {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  const entries = v instanceof Map ? [...v.entries()] : Object.entries(v);
  return Buffer.concat([
    head(5, entries.length),
    ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)]),
  ]);
}

export class SoftwareAuthenticator {
  private readonly privateKey: KeyObject;
  private readonly credentialId = randomBytes(32);
  private counter = 0;

  constructor(
    private readonly rpId: string,
    private readonly origin: string,
  ) {
    this.privateKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
  }

  private coseKey(): Buffer {
    const jwk = this.privateKey.export({ format: "jwk" });
    return cbor(
      new Map<Cbor, Cbor>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x!, "base64url")],
        [-3, Buffer.from(jwk.y!, "base64url")],
      ]),
    );
  }

  private authData(flags: number, attested: boolean): Buffer {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(++this.counter);
    const parts: Buffer[] = [sha256(this.rpId), Buffer.from([flags]), count];
    if (attested) {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(this.credentialId.length);
      parts.push(Buffer.alloc(16), len, this.credentialId, this.coseKey());
    }
    return Buffer.concat(parts);
  }

  private clientData(type: string, challenge: string): Buffer {
    return Buffer.from(
      JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }),
    );
  }

  register(options: { challenge: string }) {
    const authData = this.authData(0x45, true); // UP | UV | AT
    const attestationObject = cbor({ fmt: "none", attStmt: {}, authData });
    const id = b64url(this.credentialId);
    return {
      id,
      rawId: id,
      type: "public-key" as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(this.clientData("webauthn.create", options.challenge)),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
    };
  }

  // userVerified=false simulates a security key used without PIN or biometric.
  authenticate(options: { challenge: string }, userId: string, userVerified = true) {
    const authData = this.authData(userVerified ? 0x05 : 0x01, false);
    const clientDataJSON = this.clientData("webauthn.get", options.challenge);
    const signature = sign(
      "sha256",
      Buffer.concat([authData, sha256(clientDataJSON)]),
      this.privateKey,
    );
    const id = b64url(this.credentialId);
    return {
      id,
      rawId: id,
      type: "public-key" as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle: b64url(Buffer.from(userId)),
      },
    };
  }
}
