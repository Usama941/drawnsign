import { createHash } from "node:crypto";
import {
  degrees,
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFPage,
  PDFRawStream,
  PDFRef,
  type PDFObject,
} from "@cantoo/pdf-lib";

// Pure-JavaScript sanitiser for Vercel functions (docs/milestones/M1-core-signing.md).
// Rebuilds the document from its pages only, after flattening form fields and removing every
// page's annotations and additional actions, so document-level JavaScript, OpenAction,
// embedded files and XFA are never carried over. A post-check rejects anything that slipped
// through. Moving this into an isolated worker with qpdf is a pre-public-launch requirement.
export const PDF_LIMITS = { maxBytes: 25 * 1024 * 1024, maxPages: 200 } as const;

export type RejectReason =
  | "too_large"
  | "not_a_pdf"
  | "encrypted"
  | "malformed"
  | "no_pages"
  | "too_many_pages"
  | "unsupported_form"
  | "active_content";

export class PdfRejectedError extends Error {
  constructor(
    readonly reason: RejectReason,
    detail?: string,
  ) {
    super(`PDF rejected: ${reason}${detail ? ` (${detail})` : ""}`);
  }
}

export interface SanitizedPdf {
  bytes: Uint8Array;
  sha256: string;
  pageCount: number;
}

// Names that indicate active content or external references. None may survive sanitising.
const FORBIDDEN = new Set([
  "JS",
  "JavaScript",
  "OpenAction",
  "AA",
  "Launch",
  "EmbeddedFile",
  "EmbeddedFiles",
  "URI",
  "SubmitForm",
  "ImportData",
  "GoToR",
  "GoToE",
  "RichMedia",
  "XFA",
  "Annots",
]);

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

export async function sanitizePdf(input: Uint8Array): Promise<SanitizedPdf> {
  try {
    return await sanitize(input);
  } catch (err) {
    // Any parser failure on hostile or broken input is a rejection, never a crash.
    if (err instanceof PdfRejectedError) throw err;
    throw new PdfRejectedError("malformed");
  }
}

async function sanitize(input: Uint8Array): Promise<SanitizedPdf> {
  if (input.byteLength > PDF_LIMITS.maxBytes) throw new PdfRejectedError("too_large");
  const head = input.subarray(0, 1024);
  if (!containsAt(head, PDF_HEADER)) throw new PdfRejectedError("not_a_pdf");
  // Any /Encrypt entry (password or certificate security) is refused outright.
  if (/\/Encrypt[\s/<\[(0-9]/.test(Buffer.from(input).toString("latin1"))) {
    throw new PdfRejectedError("encrypted");
  }

  const src = await load(input);
  const pageCount = src.getPageCount();
  if (pageCount === 0) throw new PdfRejectedError("no_pages");
  if (pageCount > PDF_LIMITS.maxPages) throw new PdfRejectedError("too_many_pages");

  // Bake form field appearances into page content, then drop every annotation and action
  // before copying, so none of their objects reach the new document.
  try {
    src.getForm().flatten();
  } catch {
    throw new PdfRejectedError("unsupported_form");
  }
  for (const page of src.getPages()) {
    page.node.delete(PDFName.of("Annots"));
    page.node.delete(PDFName.of("AA"));
  }

  const out = await PDFDocument.create({ updateMetadata: false });
  for (const srcPage of src.getPages()) {
    const angle = ((srcPage.getRotation().angle % 360) + 360) % 360;
    if (angle === 0) {
      const [copy] = await out.copyPages(src, [src.getPages().indexOf(srcPage)]);
      out.addPage(copy!);
    } else {
      out.addPage(await uprightPage(out, srcPage, angle));
    }
  }
  // pdf-lib gives new pages an empty /Annots array; no page keeps one.
  for (const page of out.getPages()) page.node.delete(PDFName.of("Annots"));
  out.setProducer("drawnsign sanitiser");
  out.setCreator("drawnsign");
  const bytes = await out.save({ useObjectStreams: false });

  const check = await load(bytes);
  if (check.getPageCount() !== pageCount)
    throw new PdfRejectedError("active_content", "page count changed");
  const found = forbiddenContent(check);
  if (found) throw new PdfRejectedError("active_content", found);

  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), pageCount };
}

// Bakes a page's /Rotate into its content: the page is redrawn upright as it is displayed, so
// field positions (fractions of the displayed page), flattening and footers never deal with
// rotation.
async function uprightPage(out: PDFDocument, srcPage: PDFPage, angle: number): Promise<PDFPage> {
  if (angle % 90 !== 0) throw new PdfRejectedError("malformed");
  const embedded = await out.embedPage(srcPage);
  const { width: w, height: h } = embedded;
  const page = PDFPage.create(out);
  if (angle === 180) {
    page.setSize(w, h);
    page.drawPage(embedded, { x: w, y: h, rotate: degrees(180) });
    return page;
  }
  page.setSize(h, w);
  // Viewer rotation is clockwise; pdf-lib's rotate is counter-clockwise about (x, y).
  if (angle === 90) page.drawPage(embedded, { x: 0, y: w, rotate: degrees(-90) });
  else page.drawPage(embedded, { x: h, y: 0, rotate: degrees(90) });
  return page;
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
  } catch (err) {
    if (err instanceof EncryptedPDFError) throw new PdfRejectedError("encrypted");
    throw new PdfRejectedError("malformed");
  }
  if (doc.isEncrypted) throw new PdfRejectedError("encrypted");
  return doc;
}

// Returns the first forbidden name found anywhere in the document, or null.
function forbiddenContent(doc: PDFDocument): string | null {
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const found = findForbidden(obj, 0);
    if (found) return found;
  }
  return null;
}

function findForbidden(obj: PDFObject, depth: number): string | null {
  if (depth > 32) return "nesting too deep";
  if (obj instanceof PDFName) return FORBIDDEN.has(obj.decodeText()) ? obj.decodeText() : null;
  if (obj instanceof PDFRawStream) return findForbidden(obj.dict, depth + 1);
  if (obj instanceof PDFDict) {
    for (const [key, value] of obj.entries()) {
      if (FORBIDDEN.has(key.decodeText())) return key.decodeText();
      const found = value instanceof PDFRef ? null : findForbidden(value, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (obj instanceof PDFArray) {
    for (const value of obj.asArray()) {
      const found = value instanceof PDFRef ? null : findForbidden(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function containsAt(haystack: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}
