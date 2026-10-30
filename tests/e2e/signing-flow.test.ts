import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { Client } from "pg";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { startSmtpCapture } from "./smtp-capture";

const PORT = 3100;
const SHOTS = join(process.cwd(), "docs/screenshots");

// Saves a full-page screenshot of a main screen into docs/screenshots (committed for review).
async function shot(page: import("playwright").Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}
const BASE = `http://localhost:${PORT}`;

describe("signing flow in the browser", () => {
  let server: ChildProcess;
  let browser: Browser;
  let admin: Client;
  let smtp: Awaited<ReturnType<typeof startSmtpCapture>>;
  let storageDir: string;
  const email = "e2e-sender@example.test";
  const password = `pw-${randomBytes(12).toString("hex")}`;

  beforeAll(async () => {
    smtp = await startSmtpCapture();
    storageDir = await mkdtemp(join(tmpdir(), "drawnsign-e2e-"));
    server = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], {
      env: {
        ...process.env,
        DATABASE_URL: inject("appUrl"),
        BETTER_AUTH_URL: BASE,
        BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
        SMTP_URL: smtp.url,
        STORAGE_PROVIDER: "local",
        SEAL_MODE: "development",
        LOCAL_STORAGE_DIR: storageDir,
      },
      stdio: ["ignore", "inherit", "inherit"],
    });
    for (let i = 0; i < 120; i++) {
      const ok = await fetch(`${BASE}/login`).then(
        (r) => r.ok,
        () => false,
      );
      if (ok) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    admin = new Client({ connectionString: inject("adminUrl") });
    await admin.connect();

    // A verified sender with one PUBLIC_CUSTOMER membership.
    const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ email, password, name: "E2E Sender" }),
    });
    expect(res.ok).toBe(true);
    const link = (
      await smtp.waitFor(email, /(http:\/\/localhost:\d+\/api\/auth\/verify-email\S+)/)
    )[1]!;
    await fetch(link, { redirect: "manual" });
    const user = (
      await admin.query("SELECT id, email_verified FROM users WHERE email = $1", [email])
    ).rows[0];
    expect(user.email_verified).toBe(true);
    const tenant = (
      await admin.query(
        "INSERT INTO tenants (name, workspace_type) VALUES ('E2E', 'PUBLIC_CUSTOMER') RETURNING id",
      )
    ).rows[0];
    await admin.query(
      "INSERT INTO memberships (tenant_id, workspace_type, user_id, role) VALUES ($1, 'PUBLIC_CUSTOMER', $2, 'CUSTOMER_OWNER')",
      [tenant.id, user.id],
    );

    await mkdir(SHOTS, { recursive: true });
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
    server?.kill();
    await admin?.end();
    await smtp?.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  it("uploads, places a signature field, sends, and the signer signs", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([600, 800]).drawText("Please sign below.", { x: 50, y: 700, size: 18, font });
    const bytes = Buffer.from(await pdf.save());

    const sender = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await sender.goto(`${BASE}/login`);
    await shot(sender, "01-sign-in");
    await sender.getByLabel("Email").fill(email);
    await sender.getByLabel("Password").fill(password);
    await sender.getByRole("button", { name: "Sign in" }).click();
    await sender.waitForURL(`${BASE}/documents`);

    await sender.getByLabel("Title").fill("E2E Agreement");
    await sender
      .getByLabel("PDF file")
      .setInputFiles({ name: "agreement.pdf", mimeType: "application/pdf", buffer: bytes });
    await sender.getByRole("button", { name: "Upload" }).click();
    await sender.getByRole("link", { name: "Prepare and send" }).waitFor();
    await shot(sender, "02-documents-list");
    await sender.getByRole("link", { name: "Prepare and send" }).click();

    await sender.getByLabel("Recipient 1 name").fill("Grace Signer");
    await sender.getByLabel("Recipient 1 email").fill("grace@example.test");
    const page1 = sender.locator('[data-page="1"] canvas');
    await page1.waitFor();
    await page1.click({ position: { x: 300, y: 600 } });
    await expect(sender.locator('[data-field="SIGNATURE"]').count()).resolves.toBe(1);
    await shot(sender, "03-field-editor");
    await sender.getByRole("button", { name: "Send for signature" }).click();
    await sender.waitForURL(`${BASE}/documents`);
    await sender.getByText("SENT").waitFor();

    const token = (await smtp.waitFor("grace@example.test", /\/sign\/([A-Za-z0-9_-]{22})/))[1]!;
    const signer = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await signer.goto(`${BASE}/sign/${token}`);
    await signer.getByRole("button", { name: "Continue" }).waitFor();
    await shot(signer, "04-signing-consent");
    await signer.getByRole("checkbox").check();
    await signer.getByRole("button", { name: "Continue" }).click();
    const before = smtp.mails.length;
    await signer.getByRole("button", { name: "Email me a code" }).click();
    const code = (await smtp.waitFor("grace@example.test", /code is (\d{6})/, before))[1]!;
    await signer.getByLabel("Code").fill(code);
    await signer.getByRole("button", { name: "Verify" }).click();

    const pad = signer.getByLabel("Signature pad");
    await pad.waitFor();
    const box = (await pad.boundingBox())!;
    await signer.mouse.move(box.x + 30, box.y + 80);
    await signer.mouse.down();
    await signer.mouse.move(box.x + 120, box.y + 30, { steps: 8 });
    await signer.mouse.move(box.x + 220, box.y + 90, { steps: 8 });
    await signer.mouse.up();
    await signer.locator('[data-page="1"] img').waitFor();
    await shot(signer, "05-signing-page");
    await signer.getByRole("button", { name: "Finish and sign" }).click();
    await signer.getByText("Thank you, you have signed").waitFor();
    await shot(signer, "06-signed-result");

    const state = (
      await admin.query(
        `SELECT e.status, d.status AS doc, v.kind
         FROM envelopes e JOIN documents d ON d.id = e.document_id
         LEFT JOIN document_versions v ON v.id = e.signed_version_id
         WHERE d.title = 'E2E Agreement'`,
      )
    ).rows[0];
    expect(state).toEqual({ status: "COMPLETED", doc: "COMPLETED", kind: "SIGNED" });
  });
});
