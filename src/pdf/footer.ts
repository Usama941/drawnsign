import {
  beginMarkedContent,
  decodePDFRawStream,
  endMarkedContent,
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
} from "@cantoo/pdf-lib";
import QRCode from "qrcode";

export const DEV_SEAL_MARK = "DEVELOPMENT SEAL - NOT FOR REAL USE";
// Fraction of the page height reserved for the footer (fields may not enter it).
export const FOOTER_FRACTION = 0.05;
// Marked-content tag around the footer's own content stream, so a later version can remove
// the previous footer instead of covering it (covered text would still be extractable).
const FOOTER_TAG = "DrawnsignFooter";

export interface FooterInfo {
  publicId: string;
  versionNo: number;
  status: string;
  // QR target, including the verification token.
  verifyUrl: string;
  // Printed URL, without the token.
  displayUrl: string;
  development: boolean;
}

// Draws the identification footer (PRD sections 11-12) on every page: one line with document
// ID, version, status and verify URL, plus a verify QR code. It first blanks the footer strip,
// so a later version replaces an earlier version's footer instead of stacking on it.
export async function drawFooter(pdf: Uint8Array, info: FooterInfo): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const qr = await doc.embedPng(
    await QRCode.toBuffer(info.verifyUrl, {
      type: "png",
      margin: 0,
      width: 160,
      errorCorrectionLevel: "M",
    }),
  );
  // The development-seal mark comes before the URL so it is never the part that gets cut.
  const head = [info.publicId, `Version ${info.versionNo}`, info.status];
  if (info.development) head.push(DEV_SEAL_MARK);
  const full = [...head, `Verify at ${info.displayUrl}`].join("  \u00b7  ");
  const short = head.join("  \u00b7  ");

  for (const page of doc.getPages()) {
    page.pushOperators(pushGraphicsState(), beginMarkedContent(FOOTER_TAG));
    const { width: W, height: H } = page.getSize();
    const strip = Math.min(28, H * FOOTER_FRACTION);
    page.drawRectangle({ x: 0, y: 0, width: W, height: strip, color: rgb(1, 1, 1) });
    page.drawLine({
      start: { x: 0, y: strip },
      end: { x: W, y: strip },
      thickness: 0.3,
      color: rgb(0.7, 0.7, 0.7),
    });
    const q = strip - 4;
    page.drawImage(qr, { x: W - q - 6, y: 2, width: q, height: q });
    // Shrink to fit on one line (never wrap: a wrapped line falls off the page). On very
    // narrow pages the printed URL is dropped; the QR code still carries it.
    const room = W - q - 18;
    const fit = (text: string) => {
      let size = 7;
      while (size > 3.5 && font.widthOfTextAtSize(text, size) > room) size -= 0.25;
      return font.widthOfTextAtSize(text, size) <= room ? size : null;
    };
    const fullSize = fit(full);
    const line = fullSize !== null ? full : short;
    const size = fullSize ?? fit(short) ?? 3.5;
    page.drawText(line, {
      x: 8,
      y: (strip - size) / 2 + 1,
      size,
      font,
      color: info.development ? rgb(0.6, 0.25, 0) : rgb(0.25, 0.25, 0.25),
    });
    page.pushOperators(endMarkedContent(), popGraphicsState());
  }
  return doc.save({ useObjectStreams: false });
}

// Removes footers drawn by drawFooter() (whole content streams tagged FOOTER_TAG). Used to
// derive the SIGNED version from the SENT one: the body signers saw is untouched, and only
// the new version's footer remains.
export async function stripFooter(pdf: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const marker = `/${FOOTER_TAG} BMC`;
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    if (!(contents instanceof PDFArray)) continue;
    for (let i = contents.size() - 1; i >= 0; i--) {
      const ref = contents.get(i);
      const stream = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
      if (!(stream instanceof PDFRawStream)) continue;
      const head = Buffer.from(decodePDFRawStream(stream).decode().subarray(0, 64)).toString(
        "latin1",
      );
      if (head.includes(marker)) contents.remove(i);
    }
    page.node.set(PDFName.of("Contents"), contents);
  }
  return doc.save({ useObjectStreams: false });
}
