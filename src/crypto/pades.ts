import { createHash } from "node:crypto";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import signpdf from "@signpdf/signpdf";
import { Signer as SignPdfSigner, SUBFILTER_ETSI_CADES_DETACHED } from "@signpdf/utils";
import { PDFDocument } from "pdf-lib";
import type { SealSigner } from "./dev-seal";
import { derToPem, OID, pki, toArrayBuffer } from "./pki";
import { buildSignedData, type TimestampAuthority } from "./tsa";

const SIGNATURE_BYTES = 24_000;

class CadesSigner extends SignPdfSigner {
  constructor(
    private readonly signer: SealSigner,
    private readonly tsa: TimestampAuthority,
  ) {
    super();
  }

  // Receives the bytes covered by /ByteRange; returns a detached CAdES signature with a
  // signature timestamp (PAdES-B-T).
  override async sign(content: Buffer): Promise<Buffer> {
    const { asn1js } = pki();
    const cms = await buildSignedData({
      signer: this.signer,
      eContentType: OID.data,
      contentDigest: createHash("sha256").update(content).digest(),
      unsignedAttributes: async (signature) => [
        {
          type: OID.signatureTimeStampToken,
          value: asn1js.fromBER(toArrayBuffer(await this.tsa.timestamp(signature))).result,
        },
      ],
    });
    return Buffer.from(cms);
  }
}

// Seals a finished PDF: invisible PAdES signature (ETSI.CAdES.detached) over the whole file,
// with an RFC 3161 signature timestamp.
export async function sealPdf(
  pdf: Uint8Array,
  opts: { signer: SealSigner; tsa: TimestampAuthority; reason: string; location?: string },
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason: opts.reason,
    contactInfo: "",
    name: opts.signer.sealMode === "DEVELOPMENT" ? "drawnsign DEVELOPMENT SEAL" : "drawnsign",
    location: opts.location ?? "",
    signatureLength: SIGNATURE_BYTES,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    appName: "drawnsign",
  });
  const prepared = Buffer.from(await doc.save({ useObjectStreams: false }));
  return new Uint8Array(await signpdf.sign(prepared, new CadesSigner(opts.signer, opts.tsa)));
}

export interface SealCheck {
  signed: boolean;
  coversWholeFile: boolean;
  digestValid: boolean;
  signatureValid: boolean;
  timestampValid: boolean;
  timestampTime: Date | null;
  certificatePem: string | null;
  subject: string | null;
}

const NOT_SIGNED: SealCheck = {
  signed: false,
  coversWholeFile: false,
  digestValid: false,
  signatureValid: false,
  timestampValid: false,
  timestampTime: null,
  certificatePem: null,
  subject: null,
};

// Checks the last PAdES signature in a PDF: byte range covers the whole file, the content
// digest matches, the CMS signature verifies against the embedded certificate, and the
// signature timestamp verifies and covers the signature value. Trust in the certificate is
// a separate question (development seals are self-signed and never trusted).
export async function verifyPades(pdf: Uint8Array): Promise<SealCheck> {
  const { pkijs } = pki();
  const text = Buffer.from(pdf).toString("latin1");
  const ranges = [...text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
  const last = ranges.at(-1);
  if (!last) return NOT_SIGNED;
  const [a, b, c, d] = last.slice(1).map(Number) as [number, number, number, number];
  const result: SealCheck = {
    ...NOT_SIGNED,
    signed: true,
    coversWholeFile: a === 0 && c + d === pdf.length,
  };
  if (b + 2 > c || c + d > pdf.length) return result;

  try {
    const hex = text.slice(b + 1, c - 1).replace(/(00)+$/, "");
    const cmsDer = Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex");
    const content = Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]);
    const contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(cmsDer));
    const signedData = new pkijs.SignedData({ schema: contentInfo.content });
    const signerInfo = signedData.signerInfos[0]!;
    const cert = signedData.certificates?.[0] as InstanceType<typeof pkijs.Certificate> | undefined;
    if (cert) {
      result.certificatePem = derToPem(new Uint8Array(cert.toSchema().toBER()));
      result.subject = cert.subject.typesAndValues
        .map((tv) => tv.value.valueBlock.value)
        .join(", ");
    }

    const md = signerInfo.signedAttrs?.attributes.find((x) => x.type === OID.messageDigest);
    const expected = md ? Buffer.from(md.values[0].valueBlock.valueHexView) : null;
    result.digestValid =
      !!expected && expected.equals(createHash("sha256").update(content).digest());
    result.signatureValid = await signedData.verify({
      signer: 0,
      data: toArrayBuffer(content),
      checkChain: false,
    });

    const tsAttr = signerInfo.unsignedAttrs?.attributes.find(
      (x) => x.type === OID.signatureTimeStampToken,
    );
    if (tsAttr) {
      const tsContent = new pkijs.ContentInfo({ schema: tsAttr.values[0] });
      const tsSigned = new pkijs.SignedData({ schema: tsContent.content });
      const tstInfo = pkijs.TSTInfo.fromBER(tsSigned.encapContentInfo.eContent!.getValue());
      const imprint = Buffer.from(tstInfo.messageImprint.hashedMessage.valueBlock.valueHexView);
      const sigValue = Buffer.from(signerInfo.signature.valueBlock.valueHexView);
      const imprintOk = imprint.equals(createHash("sha256").update(sigValue).digest());
      // pkijs checks the token's signature and that its imprint covers sigValue.
      const tsOk = await tsSigned.verify({
        signer: 0,
        data: toArrayBuffer(sigValue),
        checkChain: false,
      });
      result.timestampValid = imprintOk && tsOk;
      result.timestampTime = tstInfo.genTime;
    }
  } catch {
    // Malformed signature data: leave the checks false.
  }
  return result;
}
