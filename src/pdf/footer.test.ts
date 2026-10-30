import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { DEV_SEAL_MARK, drawFooter, stripFooter } from "./footer";

function text(pdf: Uint8Array): string {
  const file = join(mkdtempSync(join(tmpdir(), "footer-")), "doc.pdf");
  writeFileSync(file, pdf);
  return execFileSync("pdftotext", [file, "-"], { encoding: "utf8" }).replace(/\s+/g, " ");
}

async function page(width: number, height: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([width, height]);
  return doc.save();
}

const info = {
  publicId: "DOC-WWWWWWWWWW",
  versionNo: 12,
  status: "Certificate of completion for version 12",
  verifyUrl: "https://example.test/verify/DOC-WWWWWWWWWW?t=abc",
  displayUrl: "a-rather-long-preview-host-name-git-branch.vercel.app/verify/DOC-WWWWWWWWWW",
  development: true,
};

describe("drawFooter", () => {
  it.each([
    [595, 842],
    [420, 595],
    [250, 400],
  ])("never cuts the development-seal mark (page %ix%i)", async (w, h) => {
    const out = text(await drawFooter(await page(w, h), info));
    expect(out).toContain(DEV_SEAL_MARK);
    expect(out).toContain("DOC-WWWWWWWWWW");
  });

  it("a later footer replaces the earlier one (no hidden leftover text)", async () => {
    const sent = await drawFooter(await page(595, 842), {
      ...info,
      status: "Sent for signature - not signed",
      development: false,
    });
    expect(text(sent)).toContain("Sent for signature");
    const signed = await drawFooter(await stripFooter(sent), { ...info, status: "Signed" });
    const out = text(signed);
    expect(out).not.toContain("Sent for signature");
    expect(out).toContain("Signed");
    expect(out).toContain(DEV_SEAL_MARK);
  });

  it("prints the verify URL when there is room", async () => {
    const out = text(
      await drawFooter(await page(842, 595), {
        ...info,
        displayUrl: "x.test/verify/DOC-WWWWWWWWWW",
      }),
    );
    expect(out).toContain("Verify at x.test/verify/DOC-WWWWWWWWWW");
  });
});
