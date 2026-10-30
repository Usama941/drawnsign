import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jsQR from "jsqr";
import { PNG } from "pngjs";

// Renders page 1 with Poppler and decodes the footer QR code, as a phone camera would.
export function readQr(pdf: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), "qr-"));
  writeFileSync(join(dir, "doc.pdf"), pdf);
  execFileSync("pdftoppm", [
    "-r",
    "300",
    "-png",
    "-f",
    "1",
    "-l",
    "1",
    "-singlefile",
    join(dir, "doc.pdf"),
    join(dir, "page"),
  ]);
  const png = PNG.sync.read(readFileSync(join(dir, "page.png")));
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!code) throw new Error("no QR code found on page 1");
  return code.data;
}

export function pdfText(pdf: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), "txt-"));
  writeFileSync(join(dir, "doc.pdf"), pdf);
  return execFileSync("pdftotext", ["-layout", join(dir, "doc.pdf"), "-"], { encoding: "utf8" });
}

// Renders page 1 to `<outBase>.png` (used for the committed screenshots).
export function renderPage(pdf: Uint8Array, outBase: string, dpi = 90): void {
  const dir = mkdtempSync(join(tmpdir(), "render-"));
  writeFileSync(join(dir, "doc.pdf"), pdf);
  execFileSync("pdftoppm", [
    "-r",
    String(dpi),
    "-png",
    "-f",
    "1",
    "-l",
    "1",
    "-singlefile",
    join(dir, "doc.pdf"),
    outBase,
  ]);
}
