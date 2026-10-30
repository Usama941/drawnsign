import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { DEV_SEAL_CN, DevSealSigner } from "./dev-seal";
import { sealPdf, verifyPades } from "./pades";
import { DevTimestampAuthority } from "./tsa";

async function samplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([600, 800]).drawText("Signed content", { x: 50, y: 700, size: 20, font });
  doc.addPage([600, 800]);
  return doc.save({ useObjectStreams: false });
}

// pdfsig (Poppler) validates the signature independently, much as Adobe Reader does.
function pdfsig(bytes: Uint8Array): string {
  const file = join(mkdtempSync(join(tmpdir(), "pdfsig-")), "doc.pdf");
  writeFileSync(file, bytes);
  try {
    return execFileSync("pdfsig", [file], { encoding: "utf8" });
  } catch (err) {
    return String((err as { stdout?: string }).stdout ?? err);
  }
}

describe("PAdES development seal", () => {
  let sealed: Uint8Array;

  beforeAll(async () => {
    const signer = await DevSealSigner.create();
    const tsa = await DevTimestampAuthority.create();
    sealed = await sealPdf(await samplePdf(), { signer, tsa, reason: "Completed and sealed" });
  });

  it("verifies: whole file covered, digest, signature and timestamp", async () => {
    const check = await verifyPades(sealed);
    expect(check).toMatchObject({
      signed: true,
      coversWholeFile: true,
      digestValid: true,
      signatureValid: true,
      timestampValid: true,
    });
    expect(check.subject).toContain(DEV_SEAL_CN);
    expect(Math.abs(check.timestampTime!.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("Poppler sees an unmodified document signed by an untrusted certificate", () => {
    const out = pdfsig(sealed);
    expect(out).toContain("Signature Validation: Signature is Valid.");
    expect(out).toMatch(/Signature Type: ETSI\.CAdES\.detached/);
    expect(out).toContain("Total document signed");
    expect(out).toMatch(/Certificate Validation: Certificate issuer (is unknown|isn't Trusted)/);
    expect(out).toContain(DEV_SEAL_CN);
  });

  it("an altered copy fails validation", async () => {
    // Change one byte inside the signed range (the producer string in the Info dictionary).
    const altered = new Uint8Array(sealed);
    const i = Buffer.from(altered).indexOf("drawnsign");
    expect(i).toBeGreaterThan(0);
    altered[i] = "D".charCodeAt(0);
    const check = await verifyPades(altered);
    expect(check.digestValid).toBe(false);
    expect(check.signatureValid).toBe(false);
    expect(pdfsig(altered)).not.toContain("Signature is Valid");
  });

  it("an unsigned PDF reports not signed", async () => {
    expect((await verifyPades(await samplePdf())).signed).toBe(false);
  });
});
