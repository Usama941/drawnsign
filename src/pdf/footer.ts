import { PDFDocument, rgb, StandardFonts } from "@cantoo/pdf-lib";
import QRCode from "qrcode";

export const DEV_SEAL_MARK = "DEVELOPMENT SEAL - NOT FOR REAL USE";
// Fraction of the page height reserved for the footer (fields may not enter it).
export const FOOTER_FRACTION = 0.05;

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
  const parts = [
    info.publicId,
    `Version ${info.versionNo}`,
    info.status,
    `Verify at ${info.displayUrl}`,
  ];
  if (info.development) parts.push(DEV_SEAL_MARK);
  const line = parts.join("  ·  ");

  for (const page of doc.getPages()) {
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
    let size = 7;
    const room = W - q - 18;
    while (size > 4 && font.widthOfTextAtSize(line, size) > room) size -= 0.25;
    page.drawText(line, {
      x: 8,
      y: (strip - size) / 2 + 1,
      size,
      font,
      color: info.development ? rgb(0.6, 0.25, 0) : rgb(0.25, 0.25, 0.25),
      maxWidth: room,
    });
  }
  return doc.save({ useObjectStreams: false });
}
