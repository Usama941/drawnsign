import { createHash } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { closeDb } from "@/db/client";
import { DEV_SEAL_MARK } from "@/pdf/footer";
import { finalizeEnvelope } from "@/signing/finalize";
import { setStorageForTests } from "@/storage";
import { pdfText, readQr } from "../qr";
import {
  configureAppEnv,
  cookieHeaders,
  sessionFor,
  signIn,
  signUpAndVerify,
} from "./auth-helpers";
import { connect, sharedStorage } from "./helpers";
import { call } from "./http";
import { lastLinkTo, sendEnvelope, signAll } from "./signing-helpers";

const verifyRoute = import("@/app/api/v1/verify/[publicId]/route");
const hashRoute = import("@/app/api/v1/verify/[publicId]/hash/route");

const { evidence, storage } = sharedStorage();
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function parse(url: string): { publicId: string; token: string } {
  const u = new URL(url);
  return { publicId: u.pathname.split("/").at(-1)!, token: u.searchParams.get("t")! };
}

async function view(publicId: string, token?: string, headers?: Headers) {
  const res = await call(verifyRoute, "GET", {
    params: { publicId },
    headers,
    url: `/api/v1/verify/${publicId}?t=${token ?? ""}`,
  });
  return res.json();
}

async function hash(publicId: string, token: string, sha256: string, headers?: Headers) {
  return (
    await call(hashRoute, "POST", { params: { publicId }, headers, json: { token, sha256 } })
  ).json();
}

describe("verification", () => {
  let admin: Client;
  let owner: Awaited<ReturnType<typeof sessionFor>>;
  let signed: { publicId: string; token: string; bytes: Uint8Array; versionId: string };
  let sent: { publicId: string; token: string; bytes: Uint8Array };

  async function versionBytes(id: string) {
    const v = (await admin.query("SELECT storage_key FROM document_versions WHERE id = $1", [id]))
      .rows[0];
    return (await evidence.get(v.storage_key))!;
  }

  beforeAll(async () => {
    configureAppEnv(inject("appUrl"));
    setStorageForTests(storage);
    admin = await connect("admin");
    owner = await sessionFor(
      admin,
      "verify-owner@example.test",
      "PUBLIC_CUSTOMER",
      "CUSTOMER_OWNER",
    );

    const emails = ["va@example.test", "vb@example.test", "vc@example.test"];
    const env = await sendEnvelope(owner.headers, emails, "SEQUENTIAL");
    const sentId = (
      await admin.query("SELECT document_version_id FROM envelopes WHERE id = $1", [env.id])
    ).rows[0].document_version_id;
    const sentBytes = await versionBytes(sentId);
    sent = { ...parse(readQr(sentBytes)), bytes: sentBytes };
    for (const e of emails) expect((await signAll(lastLinkTo(e), e)).status).toBe(200);
    const signedId = (
      await admin.query("SELECT signed_version_id FROM envelopes WHERE id = $1", [env.id])
    ).rows[0].signed_version_id;
    const signedBytes = await versionBytes(signedId);
    signed = { ...parse(readQr(signedBytes)), bytes: signedBytes, versionId: signedId };
  });

  afterAll(async () => {
    await closeDb();
    await admin.end();
  });

  it("a 3-party signed document verifies as signed, with the development seal flagged", async () => {
    const v = await view(signed.publicId, signed.token);
    expect(v).toMatchObject({
      exists: true,
      restricted: false,
      verdict: "SIGNED_DEVELOPMENT",
      development: true,
      version: { number: 3, kind: "SIGNED" },
      seal: {
        mode: "DEVELOPMENT",
        checks: {
          coversWholeFile: true,
          digestValid: true,
          signatureValid: true,
          timestampValid: true,
        },
      },
    });
    expect(v.signers.map((s: { name: string }) => s.name)).toEqual([
      "S. 1***",
      "S. 2***",
      "S. 3***",
    ]);
    expect(JSON.stringify(v)).not.toMatch(/va@example|Signer 1|Agreement/);
  });

  it("upload-to-verify: the signed file matches, an altered copy does not", async () => {
    expect(await hash(signed.publicId, signed.token, sha(signed.bytes))).toEqual({
      match: true,
      versionNo: 3,
      signed: true,
      development: true,
      thisVersion: true,
    });
    const altered = new Uint8Array(signed.bytes);
    altered[100] = altered[100]! ^ 1;
    expect(await hash(signed.publicId, signed.token, sha(altered))).toEqual({ match: false });
  });

  it("a SENT version's QR never gives a green or signed result", async () => {
    const v = await view(sent.publicId, sent.token);
    expect(v).toMatchObject({
      verdict: "NOT_SIGNED",
      version: { number: 2, kind: "SENT" },
      later: { latestSignedVersion: 3 },
    });
    expect(await hash(sent.publicId, sent.token, sha(sent.bytes))).toMatchObject({
      match: true,
      versionNo: 2,
      signed: false,
    });
  });

  it("without a valid token only existence is revealed; other tenants' ids give nothing", async () => {
    expect(await view(signed.publicId)).toEqual({ exists: true });
    expect(await view(signed.publicId, "AAAAAAAAAAAAAAAAAAAAAA")).toEqual({ exists: true });
    expect(await view("DOC-0000000000", signed.token)).toEqual({ exists: false });
    expect(await hash(signed.publicId, "AAAAAAAAAAAAAAAAAAAAAA", sha(signed.bytes))).toEqual({
      exists: true,
    });

    // Tenant B's document with tenant A's token: nothing.
    const b = await sessionFor(admin, "verify-b@example.test", "PUBLIC_CUSTOMER", "CUSTOMER_OWNER");
    const envB = await sendEnvelope(b.headers, ["vb-signer@example.test"], "PARALLEL");
    const bPublic = (
      await admin.query("SELECT public_id FROM documents WHERE id = $1", [envB.documentId])
    ).rows[0].public_id;
    expect(await view(bPublic, signed.token)).toEqual({ exists: true });
  });

  it("expired verification tokens return nothing", async () => {
    await admin
      .query(
        "UPDATE verification_tokens SET expires_at = now() - interval '1 second' WHERE version_id = $1",
        [signed.versionId],
      )
      .catch(async () => {
        // verification_tokens is insert-only for the app; the owner may still adjust in tests.
      });
    const v = await view(signed.publicId, signed.token);
    expect(v).toEqual({ exists: true });
    await admin.query(
      "UPDATE verification_tokens SET expires_at = now() + interval '7 years' WHERE version_id = $1",
      [signed.versionId],
    );
  });

  it("company documents use private verification", async () => {
    const auditor = await sessionFor(
      admin,
      "verify-auditor@example.test",
      "COMPANY_MANAGED",
      "COMPANY_AUDITOR",
    );
    // A company document in the auditor's tenant, sent by an admin of that tenant.
    const adminId = await signUpAndVerify(admin, "verify-company-admin@example.test");
    await admin.query(
      "INSERT INTO memberships (tenant_id, workspace_type, user_id, role) VALUES ($1, 'COMPANY_MANAGED', $2, 'COMPANY_ADMIN')",
      [auditor.tenantId, adminId],
    );
    await admin.query("UPDATE sessions SET mfa_verified = true WHERE user_id = $1", [adminId]);
    const adminHeaders = cookieHeaders((await signIn("verify-company-admin@example.test")).headers);
    await admin.query(
      "UPDATE sessions SET active_tenant_id = $1, mfa_verified = true WHERE user_id = $2",
      [auditor.tenantId, adminId],
    );
    const env = await sendEnvelope(adminHeaders, ["employee@example.test"], "PARALLEL");
    expect(
      (await signAll(lastLinkTo("employee@example.test"), "employee@example.test")).status,
    ).toBe(200);
    const signedId = (
      await admin.query("SELECT signed_version_id FROM envelopes WHERE id = $1", [env.id])
    ).rows[0].signed_version_id;
    const q = parse(readQr(await versionBytes(signedId)));

    expect(await view(q.publicId, q.token)).toEqual({
      exists: true,
      restricted: true,
      confidential: true,
    });
    expect(await view(q.publicId, q.token, owner.headers)).toEqual({
      exists: true,
      restricted: true,
      confidential: true,
    });
    expect(await view(q.publicId, q.token, auditor.headers)).toMatchObject({
      verdict: "SIGNED_DEVELOPMENT",
    });
  });

  it("every development-sealed file says so in its rendered footer", async () => {
    const versions = (
      await admin.query("SELECT storage_key FROM document_versions WHERE seal_mode = 'DEVELOPMENT'")
    ).rows;
    const certs = (
      await admin.query(
        "SELECT storage_key FROM completion_certificates WHERE seal_mode = 'DEVELOPMENT'",
      )
    ).rows;
    expect(versions.length).toBeGreaterThan(0);
    expect(certs.length).toBe(versions.length);
    for (const { storage_key } of [...versions, ...certs]) {
      const text = pdfText((await evidence.get(storage_key))!).replace(/\s+/g, " ");
      expect(text).not.toContain("Sent for signature");
      expect({ storage_key, marked: text.includes(DEV_SEAL_MARK) }).toEqual({
        storage_key,
        marked: true,
      });
    }
  });

  it("the certificate of completion is sealed and lists masked signers", async () => {
    const cert = (
      await admin.query(
        "SELECT storage_key FROM completion_certificates WHERE document_version_id = $1",
        [signed.versionId],
      )
    ).rows[0];
    const text = pdfText((await evidence.get(cert.storage_key))!);
    expect(text).toContain("Certificate of completion");
    expect(text).toContain("S. 1***");
    expect(text).toContain("v***@example.test");
    expect(text).toContain(sha(signed.bytes));
  });

  it("sealing refuses without SEAL_MODE, and on the production domain", async () => {
    const ctx = {
      tenantId: owner.tenantId,
      workspaceType: "PUBLIC_CUSTOMER" as const,
      userId: null,
    };
    vi.stubEnv("SEAL_MODE", "");
    await expect(
      finalizeEnvelope(ctx, "00000000-0000-0000-0000-000000000000", storage),
    ).rejects.toThrow(/go-live/);
    vi.stubEnv("SEAL_MODE", "development");
    vi.stubEnv("PRODUCTION_HOSTNAME", "app.example.com");
    vi.stubEnv("APP_URL", "https://app.example.com");
    await expect(
      finalizeEnvelope(ctx, "00000000-0000-0000-0000-000000000000", storage),
    ).rejects.toThrow(/production domain/);
    vi.unstubAllEnvs();
    process.env.SEAL_MODE = "development";
  });
});
