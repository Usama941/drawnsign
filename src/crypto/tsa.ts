import { createHash, randomBytes } from "node:crypto";
import { DevSealSigner, type SealSigner } from "./dev-seal";
import { OID, pki, toArrayBuffer } from "./pki";

// RFC 3161 timestamp authority: returns a TimeStampToken (CMS ContentInfo, DER) over
// sha256(data).
export interface TimestampAuthority {
  readonly development: boolean;
  timestamp(data: Uint8Array): Promise<Uint8Array>;
}

// In-process development TSA with its own in-memory key and self-signed certificate. Only for
// development seals and tests; production uses a commercial TSA (pre-go-live requirement).
export class DevTimestampAuthority implements TimestampAuthority {
  readonly development = true;
  private constructor(private readonly signer: SealSigner) {}

  static async create(): Promise<DevTimestampAuthority> {
    return new DevTimestampAuthority(
      await DevSealSigner.create("drawnsign DEVELOPMENT TSA - NOT TRUSTED", OID.timeStamping),
    );
  }

  async timestamp(data: Uint8Array): Promise<Uint8Array> {
    const { pkijs, asn1js } = pki();
    const imprint = createHash("sha256").update(data).digest();
    const tstInfo = new pkijs.TSTInfo({
      version: 1,
      policy: "1.3.6.1.4.1.99999.1.1",
      messageImprint: new pkijs.MessageImprint({
        hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
        hashedMessage: new asn1js.OctetString({ valueHex: toArrayBuffer(imprint) }),
      }),
      serialNumber: new asn1js.Integer({ valueHex: toArrayBuffer(randomBytes(8)) }),
      genTime: new Date(),
      accuracy: new pkijs.Accuracy({ seconds: 1 }),
    });
    const content = new Uint8Array(tstInfo.toSchema().toBER());
    return buildSignedData({
      signer: this.signer,
      eContentType: OID.tstInfo,
      eContent: content,
      contentDigest: createHash("sha256").update(content).digest(),
    });
  }
}

// A public or commercial RFC 3161 TSA over HTTP.
export class HttpTimestampAuthority implements TimestampAuthority {
  readonly development: boolean;
  constructor(
    private readonly url: string,
    development: boolean,
  ) {
    this.development = development;
  }

  async timestamp(data: Uint8Array): Promise<Uint8Array> {
    const { pkijs, asn1js } = pki();
    const req = new pkijs.TimeStampReq({
      version: 1,
      messageImprint: new pkijs.MessageImprint({
        hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
        hashedMessage: new asn1js.OctetString({
          valueHex: toArrayBuffer(createHash("sha256").update(data).digest()),
        }),
      }),
      nonce: new asn1js.Integer({ valueHex: toArrayBuffer(randomBytes(8)) }),
      certReq: true,
    });
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/timestamp-query" },
      body: Buffer.from(req.toSchema().toBER()),
    });
    if (!res.ok) throw new Error(`TSA returned ${res.status}`);
    const parsed = pkijs.TimeStampResp.fromBER(await res.arrayBuffer());
    if (parsed.status.status > 1 || !parsed.timeStampToken)
      throw new Error("TSA refused the request");
    return new Uint8Array(parsed.timeStampToken.toSchema().toBER());
  }
}

// Builds a CMS SignedData (ContentInfo, DER) with CAdES signed attributes: content type,
// message digest and signing-certificate-v2. Detached when eContent is omitted.
export async function buildSignedData(opts: {
  signer: SealSigner;
  eContentType: string;
  eContent?: Uint8Array;
  contentDigest: Uint8Array;
  unsignedAttributes?: (signature: Uint8Array) => Promise<{ type: string; value: unknown }[]>;
}): Promise<Uint8Array> {
  const { pkijs, asn1js } = pki();
  const certDer = await opts.signer.certificateDer();
  const cert = pkijs.Certificate.fromBER(toArrayBuffer(certDer));
  const certHash = createHash("sha256").update(certDer).digest();

  const signedAttrs = new pkijs.SignedAndUnsignedAttributes({
    type: 0,
    attributes: [
      new pkijs.Attribute({
        type: OID.contentType,
        values: [new asn1js.ObjectIdentifier({ value: opts.eContentType })],
      }),
      new pkijs.Attribute({
        type: OID.messageDigest,
        values: [new asn1js.OctetString({ valueHex: toArrayBuffer(opts.contentDigest) })],
      }),
      new pkijs.Attribute({
        type: OID.signingCertificateV2,
        values: [
          // SigningCertificateV2 { certs: [ ESSCertIDv2 { certHash } ] } (sha256 is the default hash)
          new asn1js.Sequence({
            value: [
              new asn1js.Sequence({
                value: [
                  new asn1js.Sequence({
                    value: [new asn1js.OctetString({ valueHex: toArrayBuffer(certHash) })],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
  // Signed attributes are signed as a DER SET OF (tag 0x31), not the [0] used in SignerInfo.
  const toSign = new Uint8Array(signedAttrs.toSchema().toBER());
  toSign[0] = 0x31;
  const signature = await opts.signer.sign(toSign);

  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
    digestAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
    signedAttrs,
    signatureAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.ecdsaWithSha256 }),
    signature: new asn1js.OctetString({ valueHex: toArrayBuffer(signature) }),
  });
  if (opts.unsignedAttributes) {
    const attrs = await opts.unsignedAttributes(signature);
    signerInfo.unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({
      type: 1,
      attributes: attrs.map(
        (a) => new pkijs.Attribute({ type: a.type, values: [a.value as never] }),
      ),
    });
  }

  const signedData = new pkijs.SignedData({
    version: opts.eContent ? 3 : 1,
    digestAlgorithms: [new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 })],
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: opts.eContentType,
      ...(opts.eContent
        ? { eContent: new asn1js.OctetString({ valueHex: toArrayBuffer(opts.eContent) }) }
        : {}),
    }),
    certificates: [cert],
    signerInfos: [signerInfo],
  });
  const contentInfo = new pkijs.ContentInfo({
    contentType: OID.signedData,
    content: signedData.toSchema(true),
  });
  return new Uint8Array(contentInfo.toSchema().toBER());
}
