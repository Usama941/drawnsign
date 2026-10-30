import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";

export interface CertificateSigner {
  name: string;
  email: string;
  routingOrder: number;
  events: {
    type: string;
    at: Date;
    ip: string | null;
    userAgent: string | null;
    authMethod: string | null;
  }[];
}

export interface CertificateData {
  publicId: string;
  title: string;
  signedVersionNo: number;
  signedSha256: string;
  sentSha256: string;
  sentAt: Date | null;
  completedAt: Date | null;
  issuer: string;
  signers: CertificateSigner[];
}

// "Ada Lovelace" -> "A. L***"; masked as on the public verify page (PRD section 12).
export function maskName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? `${parts.at(-1)![0]}***` : "***";
  return `${first.toUpperCase()}. ${last.toUpperCase().slice(0, 1)}${last.slice(1)}`;
}

// "ada@example.com" -> "a***@example.com"
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${(local ?? "")[0] ?? ""}***@${domain ?? ""}`;
}

const iso = (d: Date | null) =>
  d
    ? d
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d+Z$/, " UTC")
    : "-";
const sanitize = (s: string) => s.replace(/[^\x20-\x7e -ÿ]/g, "?");

// Certificate of completion: a separate PDF listing signers, authentication, IPs, times and
// the version hashes (PRD section 4 of the shared requirements). Sealed like the document.
export async function buildCertificate(data: CertificateData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Certificate of completion ${data.publicId}`);
  doc.setProducer("drawnsign");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595;
  const H = 842;
  const bottom = H * 0.05 + 24;
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - 56;

  const write = (
    text: string,
    opts: { f?: PDFFont; size?: number; indent?: number; gap?: number } = {},
  ) => {
    const size = opts.size ?? 9;
    if (y < bottom) {
      page = doc.addPage([W, H]);
      y = H - 56;
    }
    page.drawText(sanitize(text), {
      x: 48 + (opts.indent ?? 0),
      y,
      size,
      font: opts.f ?? font,
      color: rgb(0.1, 0.1, 0.1),
      maxWidth: W - 96,
    });
    y -= size + (opts.gap ?? 5);
  };

  write("Certificate of completion", { f: bold, size: 18, gap: 14 });
  write(`Document: ${data.title}`);
  write(`Document ID: ${data.publicId}`);
  write(`Signed version: ${data.signedVersionNo}`);
  write(`Signed version SHA-256: ${data.signedSha256}`, { size: 8 });
  write(`Version sent for signature, SHA-256: ${data.sentSha256}`, { size: 8 });
  write(`Sent: ${iso(data.sentAt)}    Completed: ${iso(data.completedAt)}`);
  write(`Issued by: ${data.issuer}`, { gap: 14 });

  write("Signers", { f: bold, size: 12, gap: 8 });
  for (const s of [...data.signers].sort((a, b) => a.routingOrder - b.routingOrder)) {
    write(`${s.routingOrder}. ${maskName(s.name)}  <${maskEmail(s.email)}>`, { f: bold });
    for (const e of s.events) {
      write(
        `${iso(e.at)}  ${e.type}${e.authMethod ? ` (${e.authMethod})` : ""}  IP ${e.ip ?? "-"}`,
        { indent: 14, size: 8, gap: 2 },
      );
      if (e.userAgent) write(e.userAgent.slice(0, 120), { indent: 28, size: 7, gap: 4 });
    }
    y -= 6;
  }
  write(
    "Each signer received a personal link by email and confirmed a one-time code sent to that address before signing.",
    {
      size: 8,
    },
  );
  return doc.save({ useObjectStreams: false });
}
