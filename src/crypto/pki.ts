// @peculiar/x509 needs the Reflect metadata polyfill.
import "reflect-metadata";
import { webcrypto } from "node:crypto";
import * as x509 from "@peculiar/x509";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

// pkijs and @peculiar/x509 use WebCrypto; point both at Node's implementation once.
let ready = false;
export function pki() {
  if (!ready) {
    pkijs.setEngine(
      "node",
      new pkijs.CryptoEngine({ name: "node", crypto: webcrypto as unknown as Crypto }),
    );
    x509.cryptoProvider.set(webcrypto as unknown as Crypto);
    ready = true;
  }
  return { pkijs, asn1js, x509 };
}

export const OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  tstInfo: "1.2.840.113549.1.9.16.1.4",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  signatureTimeStampToken: "1.2.840.113549.1.9.16.2.14",
  sha256: "2.16.840.1.101.3.4.2.1",
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
  timeStamping: "1.3.6.1.5.5.7.3.8",
} as const;

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function derToPem(der: Uint8Array, label = "CERTIFICATE"): string {
  const b64 = Buffer.from(der)
    .toString("base64")
    .match(/.{1,64}/g)!
    .join("\n");
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}
