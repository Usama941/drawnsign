import { createHash } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { closeDb } from "@/db/client";
import { hashToken } from "@/documents/ids";
import { finalizeEnvelope } from "@/signing/finalize";
import { expireEnvelope } from "@/signing/finalize";
import { setStorageForTests } from "@/storage";
import { configureAppEnv, mailer, sessionFor } from "./auth-helpers";
import { lastLinkTo, linksTo, r, sendEnvelope, signAll, signerSession } from "./signing-helpers";
import { connect, sharedStorage } from "./helpers";
import { call } from "./http";

const { evidence, storage } = sharedStorage();

describe("envelopes and signing", () => {
  let admin: Client;
  let owner: { headers: Headers; tenantId: string; userId: string };
  let other: { headers: Headers; tenantId: string; userId: string };

  const envelope = sendEnvelope;

  beforeAll(async () => {
    configureAppEnv(inject("appUrl"));
    setStorageForTests(storage);
    admin = await connect("admin");
    owner = await sessionFor(admin, "sign-owner@example.test", "PUBLIC_CUSTOMER", "CUSTOMER_OWNER");
    other = await sessionFor(admin, "sign-other@example.test", "PUBLIC_CUSTOMER", "CUSTOMER_OWNER");
  });

  afterAll(async () => {
    await closeDb();
    await admin.end();
  });

  it("three sequential signers complete, in order, into a new SIGNED version", async () => {
    const emails = ["s1@example.test", "s2@example.test", "s3@example.test"];
    const env = await envelope(owner.headers, emails, "SEQUENTIAL");
    expect(emails.map(linksTo)).toEqual([1, 0, 0]);

    const sentBefore = (
      await admin.query("SELECT document_version_id, version_sha256 FROM envelopes WHERE id = $1", [
        env.id,
      ])
    ).rows[0];
    const sentRow = (
      await admin.query("SELECT storage_key, sha256 FROM document_versions WHERE id = $1", [
        sentBefore.document_version_id,
      ])
    ).rows[0];

    for (const [i, email] of emails.entries()) {
      const res = await signAll(lastLinkTo(email), email);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        signed: true,
        envelopeCompleted: i === emails.length - 1,
      });
      if (i < emails.length - 1) expect(linksTo(emails[i + 1]!)).toBe(1);
    }

    const state = await (
      await call(r.envelope, "GET", { headers: owner.headers, params: { id: env.id } })
    ).json();
    expect(state.status).toBe("COMPLETED");
    expect(state.signedVersionId).toBeTruthy();

    const versions = (
      await admin.query(
        "SELECT id, kind, parent_version_id, sha256 FROM document_versions WHERE document_id = $1 ORDER BY version_no",
        [env.documentId],
      )
    ).rows;
    expect(versions.map((v) => v.kind)).toEqual(["DRAFT", "SENT", "SIGNED"]);
    expect(versions[2].parent_version_id).toBe(versions[1].id);
    expect(versions[2].sha256).not.toBe(versions[1].sha256);

    // The SENT version's bytes and hash are untouched.
    const sentBytes = await evidence.get(sentRow.storage_key);
    expect(createHash("sha256").update(sentBytes!).digest("hex")).toBe(sentRow.sha256);
    expect(sentRow.sha256).toBe(sentBefore.version_sha256);

    const events = (
      await admin.query(
        "SELECT type, version_sha256 FROM signature_events WHERE envelope_id = $1 AND type = 'SIGNED'",
        [env.id],
      )
    ).rows;
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.version_sha256 === sentRow.sha256)).toBe(true);
    const doc = (
      await admin.query("SELECT status, current_version_id FROM documents WHERE id = $1", [
        env.documentId,
      ])
    ).rows[0];
    expect(doc).toEqual({ status: "COMPLETED", current_version_id: state.signedVersionId });
  });

  it("recipient 2 cannot sign before recipient 1, even with a link", async () => {
    const env = await envelope(owner.headers, ["o1@example.test", "o2@example.test"], "SEQUENTIAL");
    const r2 = (
      await admin.query("SELECT id FROM recipients WHERE envelope_id = $1 AND routing_order = 2", [
        env.id,
      ])
    ).rows[0];
    const ver = (
      await admin.query("SELECT document_version_id FROM envelopes WHERE id = $1", [env.id])
    ).rows[0];
    const forged = "AAAAAAAAAAAAAAAAAAAAAA";
    await admin.query(
      `INSERT INTO signing_tokens (tenant_id, envelope_id, recipient_id, document_version_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '1 day')`,
      [owner.tenantId, env.id, r2.id, ver.document_version_id, hashToken(forged)],
    );
    expect((await call(r.view, "GET", { params: { token: forged } })).status).toBe(404);
  });

  it("a declined envelope can't be completed", async () => {
    const env = await envelope(owner.headers, ["d1@example.test", "d2@example.test"], "PARALLEL");
    const t1 = lastLinkTo("d1@example.test");
    const t2 = lastLinkTo("d2@example.test");
    const headers = await signerSession(t1, "d1@example.test");
    expect(
      (
        await call(r.decline, "POST", {
          params: { token: t1 },
          headers,
          json: { reason: "Wrong terms" },
        })
      ).status,
    ).toBe(200);
    expect((await call(r.view, "GET", { params: { token: t2 } })).status).toBe(404);
    expect((await call(r.view, "GET", { params: { token: t1 } })).status).toBe(404);
    const state = (await admin.query("SELECT status FROM envelopes WHERE id = $1", [env.id]))
      .rows[0];
    expect(state.status).toBe("DECLINED");
    expect(mailer.sent.findLast((m) => m.to === "sign-owner@example.test")?.subject).toMatch(
      /Declined/,
    );
  });

  it("wrong, expired and used tokens get 404; links can't reach another tenant", async () => {
    expect((await call(r.view, "GET", { params: { token: "nope" } })).status).toBe(404);
    expect(
      (await call(r.view, "GET", { params: { token: "BBBBBBBBBBBBBBBBBBBBBB" } })).status,
    ).toBe(404);

    const env = await envelope(owner.headers, ["x1@example.test"], "PARALLEL");
    const token = lastLinkTo("x1@example.test");
    // Another tenant's session doesn't help, and their API can't see this envelope.
    expect(
      (await call(r.envelope, "GET", { headers: other.headers, params: { id: env.id } })).status,
    ).toBe(404);

    await admin.query(
      "UPDATE signing_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = $1",
      [hashToken(token)],
    );
    expect((await call(r.view, "GET", { params: { token } })).status).toBe(404);
    await admin.query(
      "UPDATE signing_tokens SET expires_at = now() + interval '1 day' WHERE token_hash = $1",
      [hashToken(token)],
    );
    expect((await signAll(token, "x1@example.test")).status).toBe(200);
    expect((await call(r.view, "GET", { params: { token } })).status).toBe(404);
  });

  it("the document and fields need a verified signer session", async () => {
    await envelope(owner.headers, ["v1@example.test"], "PARALLEL");
    const token = lastLinkTo("v1@example.test");
    const view = await (await call(r.view, "GET", { params: { token } })).json();
    expect(view).toMatchObject({ verified: false, fields: [] });
    expect((await call(r.doc, "GET", { params: { token } })).status).toBe(401);
    expect((await call(r.sign, "POST", { params: { token }, json: { values: [] } })).status).toBe(
      401,
    );
    const headers = await signerSession(token, "v1@example.test");
    const doc = await call(r.doc, "GET", { params: { token }, headers });
    expect(doc.headers.get("content-type")).toBe("application/pdf");
  });

  it("stops OTP brute force after 5 wrong codes, even for the right code", async () => {
    await envelope(owner.headers, ["bf@example.test"], "PARALLEL");
    const token = lastLinkTo("bf@example.test");
    const p = { token };
    await call(r.consent, "POST", { params: p });
    await call(r.otp, "POST", { params: p });
    const code = /code is (\d{6})/.exec(
      mailer.sent.findLast((x) => x.to === "bf@example.test")!.text,
    )![1]!;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      expect((await call(r.verify, "POST", { params: p, json: { code: wrong } })).status).toBe(400);
    }
    expect((await call(r.verify, "POST", { params: p, json: { code } })).status).toBe(429);
    const audits = (
      await admin.query(
        "SELECT count(*)::int AS n FROM audit_ledger WHERE action = 'signer.otp_failed'",
      )
    ).rows[0];
    expect(audits.n).toBeGreaterThanOrEqual(5);
    // Code requests are rate-limited too: 3 per 15 minutes.
    await call(r.otp, "POST", { params: p });
    await call(r.otp, "POST", { params: p });
    expect((await call(r.otp, "POST", { params: p })).status).toBe(429);
  });

  it("rejects invalid field values and unknown fields", async () => {
    await envelope(owner.headers, ["iv@example.test"], "PARALLEL");
    const token = lastLinkTo("iv@example.test");
    const headers = await signerSession(token, "iv@example.test");
    const view = await (await call(r.view, "GET", { params: { token }, headers })).json();
    const sig = view.fields.find((f: { type: string }) => f.type === "SIGNATURE");
    const bad = [
      [{ fieldId: sig.id, value: "data:image/png;base64,AAAA" }],
      [{ fieldId: "00000000-0000-0000-0000-000000000000", value: "x" }],
      [],
    ];
    for (const values of bad) {
      expect(
        (await call(r.sign, "POST", { params: { token }, headers, json: { values } })).status,
      ).toBe(400);
    }
  });

  it("sending freezes the envelope; voiding stops signing", async () => {
    const env = await envelope(owner.headers, ["vd@example.test"], "PARALLEL");
    await expect(
      admin.query("UPDATE envelopes SET order_mode = 'SEQUENTIAL' WHERE id = $1", [env.id]),
    ).rejects.toThrow(/frozen/);
    await expect(
      admin.query(
        `INSERT INTO fields (tenant_id, envelope_id, recipient_id, type, page, x, y, width, height)
         SELECT tenant_id, envelope_id, id, 'TEXT', 1, 0, 0, 0.1, 0.1 FROM recipients WHERE envelope_id = $1`,
        [env.id],
      ),
    ).rejects.toThrow(/draft envelope/);
    const token = lastLinkTo("vd@example.test");
    expect(
      (
        await call(r.void, "POST", {
          headers: owner.headers,
          params: { id: env.id },
          json: { reason: "typo" },
        })
      ).status,
    ).toBe(200);
    expect((await call(r.view, "GET", { params: { token } })).status).toBe(404);
  });

  it("jobs refuse a mismatched tenant; expiry runs inside the envelope's tenant", async () => {
    const env = await envelope(owner.headers, ["ex@example.test"], "PARALLEL");
    const wrong = {
      tenantId: other.tenantId,
      workspaceType: "PUBLIC_CUSTOMER" as const,
      userId: null,
    };
    await expect(finalizeEnvelope(wrong, env.id, storage)).rejects.toThrow(
      /envelope not found in tenant/,
    );
    await expect(expireEnvelope(wrong, env.id)).rejects.toThrow(/envelope not found in tenant/);

    const right = {
      tenantId: owner.tenantId,
      workspaceType: "PUBLIC_CUSTOMER" as const,
      userId: null,
    };
    expect(await expireEnvelope(right, env.id)).toBe(false);
    await admin.query(
      "UPDATE envelopes SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [env.id],
    );
    expect(await expireEnvelope(right, env.id)).toBe(true);
    const state = (
      await admin.query(
        "SELECT e.status, d.status AS doc FROM envelopes e JOIN documents d ON d.id = e.document_id WHERE e.id = $1",
        [env.id],
      )
    ).rows[0];
    expect(state).toEqual({ status: "EXPIRED", doc: "EXPIRED" });
  });
});
