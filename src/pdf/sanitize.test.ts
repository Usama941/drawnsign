import { degrees, PDFDocument, PDFName, PDFString, StandardFonts } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { PDF_LIMITS, PdfRejectedError, sanitizePdf } from "./sanitize";

async function hostilePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  page.drawText("hello", { x: 20, y: 250, font: await doc.embedFont(StandardFonts.Helvetica) });
  const ctx = doc.context;
  const js = (code: string) => ctx.obj({ Type: "Action", S: "JavaScript", JS: PDFString.of(code) });

  // Document-level OpenAction and named JavaScript.
  doc.catalog.set(PDFName.of("OpenAction"), ctx.register(js("app.alert('open')")));
  doc.catalog.set(
    PDFName.of("Names"),
    ctx.obj({
      JavaScript: ctx.obj({ Names: [PDFString.of("x"), ctx.register(js("app.alert(1)"))] }),
    }),
  );
  // Embedded file.
  await doc.attach(new TextEncoder().encode("payload"), "payload.txt", { mimeType: "text/plain" });
  // Page additional action and a launch annotation.
  page.node.set(PDFName.of("AA"), ctx.obj({ O: ctx.register(js("app.alert('page')")) }));
  const launch = ctx.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [0, 0, 50, 50],
    A: ctx.obj({ S: "Launch", F: PDFString.of("cmd.exe") }),
  });
  page.node.set(PDFName.of("Annots"), ctx.obj([ctx.register(launch)]));
  // A filled form field whose widget carries a script.
  const field = doc.getForm().createTextField("name");
  field.setText("Ada Lovelace");
  field.addToPage(page, { x: 20, y: 100, width: 200, height: 30 });
  field.acroField
    .getWidgets()[0]!
    .dict.set(PDFName.of("AA"), ctx.obj({ K: ctx.register(js("1")) }));

  return doc.save({ useObjectStreams: false });
}

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

async function reason(input: Uint8Array): Promise<string> {
  try {
    await sanitizePdf(input);
    return "accepted";
  } catch (err) {
    return err instanceof PdfRejectedError ? err.reason : `threw: ${String(err)}`;
  }
}

describe("sanitizePdf", () => {
  it("removes JavaScript, OpenAction, embedded files, launch actions and annotations", async () => {
    const input = await hostilePdf();
    for (const marker of ["/JavaScript", "/OpenAction", "/EmbeddedFile", "/Launch", "/AA"]) {
      expect(text(input)).toContain(marker);
    }
    const out = await sanitizePdf(input);
    for (const marker of [
      "/JavaScript",
      "/JS",
      "/OpenAction",
      "/EmbeddedFile",
      "/Launch",
      "/AA",
      "/Annots",
      "/AcroForm",
    ]) {
      expect({ marker, found: text(out.bytes).includes(marker) }).toEqual({ marker, found: false });
    }
    expect(out.pageCount).toBe(1);
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps a flattened field's visible value as page content", async () => {
    const out = await sanitizePdf(await hostilePdf());
    const reloaded = await PDFDocument.load(out.bytes);
    expect(reloaded.getPageCount()).toBe(1);
    // The flattened field becomes a form XObject drawn on the page.
    expect(text(out.bytes)).toMatch(/\/Subtype \/Form/);
  });

  it("is idempotent on its own output", async () => {
    const once = await sanitizePdf(await hostilePdf());
    const twice = await sanitizePdf(once.bytes);
    expect(twice.pageCount).toBe(once.pageCount);
  });

  it.each([90, 180, 270])(
    "turns a page rotated %i degrees upright, as displayed",
    async (angle) => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([600, 800]);
      page.drawText("rotated", { x: 50, y: 700 });
      page.setRotation(degrees(angle));
      const out = await PDFDocument.load((await sanitizePdf(await doc.save())).bytes);
      const upright = out.getPage(0);
      expect(upright.getRotation().angle).toBe(0);
      expect(upright.getSize()).toEqual(
        angle === 180 ? { width: 600, height: 800 } : { width: 800, height: 600 },
      );
    },
  );

  it("rejects encrypted PDFs", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.encrypt({ userPassword: "u", ownerPassword: "o" });
    expect(await reason(await doc.save())).toBe("encrypted");
  });

  it("rejects malformed input and non-PDFs", async () => {
    expect(await reason(new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog"))).toBe(
      "malformed",
    );
    expect(await reason(new TextEncoder().encode("%PDF-1.7 broken"))).toBe("malformed");
    expect(await reason(new TextEncoder().encode("GIF89a"))).toBe("not_a_pdf");
  });

  it("rejects files over 25 MB and documents over 200 pages", async () => {
    const big = new Uint8Array(PDF_LIMITS.maxBytes + 1);
    big.set(new TextEncoder().encode("%PDF-1.7"));
    expect(await reason(big)).toBe("too_large");

    const doc = await PDFDocument.create();
    for (let i = 0; i < PDF_LIMITS.maxPages + 1; i++) doc.addPage([100, 100]);
    expect(await reason(await doc.save())).toBe("too_many_pages");
  });
});
