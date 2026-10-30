import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";

export interface FilledField {
  type: "SIGNATURE" | "INITIALS" | "DATE" | "TEXT" | "CHECKBOX" | "DROPDOWN";
  page: number; // 1-based
  // Fractions of the page, origin top-left.
  x: number;
  y: number;
  width: number;
  height: number;
  value: string;
}

const INK = rgb(0.05, 0.1, 0.3);

// Draws every filled field onto the frozen version's pages. The result has no form fields or
// annotations: values are page content.
export async function flattenFields(pdf: Uint8Array, filled: FilledField[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  for (const f of filled) {
    const page = pages[f.page - 1];
    if (!page) throw new Error(`field on missing page ${f.page}`);
    const { width: W, height: H } = page.getSize();
    const rect = { x: f.x * W, y: H - (f.y + f.height) * H, w: f.width * W, h: f.height * H };
    switch (f.type) {
      case "SIGNATURE":
      case "INITIALS":
        await drawImage(doc, page, rect, f.value);
        break;
      case "CHECKBOX":
        if (f.value === "true") drawCheck(page, rect);
        break;
      default:
        drawText(page, font, rect, f.value);
    }
  }
  return doc.save({ useObjectStreams: false });
}

type Rect = { x: number; y: number; w: number; h: number };

async function drawImage(doc: PDFDocument, page: PDFPage, r: Rect, dataUrl: string) {
  const png = await doc.embedPng(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
  const scale = Math.min(r.w / png.width, r.h / png.height);
  const w = png.width * scale;
  const h = png.height * scale;
  page.drawImage(png, { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, width: w, height: h });
}

function drawText(page: PDFPage, font: PDFFont, r: Rect, value: string) {
  const size = Math.max(6, Math.min(12, r.h * 0.7));
  let text = value.replace(/[^\x20-\x7e -ÿ]/g, "?");
  while (text.length > 1 && font.widthOfTextAtSize(text, size) > r.w) text = text.slice(0, -1);
  page.drawText(text, {
    x: r.x + 1,
    y: r.y + (r.h - size) / 2 + size * 0.2,
    size,
    font,
    color: INK,
  });
}

function drawCheck(page: PDFPage, r: Rect) {
  const t = Math.max(1, Math.min(r.w, r.h) * 0.12);
  page.drawLine({
    start: { x: r.x + r.w * 0.15, y: r.y + r.h * 0.5 },
    end: { x: r.x + r.w * 0.4, y: r.y + r.h * 0.2 },
    thickness: t,
    color: INK,
  });
  page.drawLine({
    start: { x: r.x + r.w * 0.4, y: r.y + r.h * 0.2 },
    end: { x: r.x + r.w * 0.85, y: r.y + r.h * 0.85 },
    thickness: t,
    color: INK,
  });
}
