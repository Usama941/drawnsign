import { PDFDocument, PDFName, PDFString } from "@cantoo/pdf-lib";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { closeDb } from "@/db/client";
import { MemoryObjectStore } from "@/storage/memory-store";
import { setStorageForTests, Storage } from "@/storage";
import { configureAppEnv, sessionFor } from "./auth-helpers";
import { connect } from "./helpers";
import { call } from "./http";

const documentsRoute = import("@/app/api/v1/documents/route");
const documentRoute = import("@/app/api/v1/documents/[id]/route");
const versionsRoute = import("@/app/api/v1/documents/[id]/versions/route");
const uploadRoute = import("@/app/api/v1/uploads/[id]/route");
const contentRoute = import("@/app/api/v1/uploads/[id]/content/route");
const completeRoute = import("@/app/api/v1/uploads/[id]/complete/route");

async function pdfWithScript(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.catalog.set(
    PDFName.of("OpenAction"),
    doc.context.obj({ S: "JavaScript", JS: PDFString.of("app.alert(1)") }),
  );
  return doc.save({ useObjectStreams: false });
}

describe("documents and uploads API", () => {
  let admin: Client;
  const drafts = new MemoryObjectStore();
  let owner: Headers;
  let otherTenant: Headers;
  let viewer: Headers;
  let employee: Headers;

  async function upload(headers: Headers, uploadId: string, bytes: Uint8Array) {
    const put = await call(contentRoute, "PUT", { headers, params: { id: uploadId }, body: bytes });
    expect(put.status).toBe(204);
    const done = await call(completeRoute, "POST", { headers, params: { id: uploadId } });
    expect(done.status).toBe(202);
    return (await call(uploadRoute, "GET", { headers, params: { id: uploadId } })).json();
  }

  async function newDocument(headers: Headers) {
    const res = await call(documentsRoute, "POST", { headers, json: { title: "Contract" } });
    expect(res.status).toBe(201);
    return (await res.json()) as { documentId: string; publicId: string; upload: { id: string } };
  }

  beforeAll(async () => {
    configureAppEnv(inject("appUrl"));
    setStorageForTests(new Storage(drafts, new MemoryObjectStore()));
    admin = await connect("admin");
    owner = (await sessionFor(admin, "up-owner@example.test", "PUBLIC_CUSTOMER", "CUSTOMER_OWNER"))
      .headers;
    otherTenant = (
      await sessionFor(admin, "up-other@example.test", "PUBLIC_CUSTOMER", "CUSTOMER_OWNER")
    ).headers;
    viewer = (
      await sessionFor(admin, "up-viewer@example.test", "PUBLIC_CUSTOMER", "CUSTOMER_VIEWER")
    ).headers;
    employee = (
      await sessionFor(admin, "up-emp@example.test", "COMPANY_MANAGED", "COMPANY_EMPLOYEE")
    ).headers;
  });

  afterAll(async () => {
    await closeDb();
    await admin.end();
  });

  it("sanitises an upload into a DRAFT version and deletes the raw bytes", async () => {
    const doc = await newDocument(owner);
    expect(doc.publicId).toMatch(/^DOC-[0-9A-Z]{10}$/);
    const status = await upload(owner, doc.upload.id, await pdfWithScript());
    expect(status).toMatchObject({ status: "ACCEPTED", documentId: doc.documentId });

    const versions = await (
      await call(versionsRoute, "GET", { headers: owner, params: { id: doc.documentId } })
    ).json();
    expect(versions.versions).toHaveLength(1);
    expect(versions.versions[0]).toMatchObject({ versionNo: 1, kind: "DRAFT", pageCount: 1 });

    const { rows } = await admin.query(
      "SELECT storage_key, sha256 FROM document_versions WHERE id = $1",
      [status.versionId],
    );
    const clean = await drafts.get(rows[0].storage_key);
    expect(Buffer.from(clean!).toString("latin1")).not.toContain("/JavaScript");
    const { rows: up } = await admin.query("SELECT storage_key FROM uploads WHERE id = $1", [
      doc.upload.id,
    ]);
    expect(await drafts.get(up[0].storage_key)).toBeNull();

    const got = await (
      await call(documentRoute, "GET", { headers: owner, params: { id: doc.documentId } })
    ).json();
    expect(got.currentVersionId).toBe(status.versionId);
  });

  it("rejects a malformed upload, records why, and audits it", async () => {
    const doc = await newDocument(owner);
    const status = await upload(owner, doc.upload.id, new TextEncoder().encode("%PDF-1.7 broken"));
    expect(status).toMatchObject({ status: "REJECTED", rejectReason: "malformed" });
    const { rows } = await admin.query(
      "SELECT action FROM audit_ledger WHERE object_id = $1 ORDER BY seq",
      [doc.upload.id],
    );
    expect(rows.map((r) => r.action)).toContain("document.upload_rejected");
  });

  it("chains a second upload as version 2 with version 1 as parent", async () => {
    const doc = await newDocument(owner);
    const first = await upload(owner, doc.upload.id, await pdfWithScript());
    const res = await call(versionsRoute, "POST", {
      headers: owner,
      params: { id: doc.documentId },
    });
    expect(res.status).toBe(201);
    const second = await upload(owner, (await res.json()).upload.id, await pdfWithScript());
    const { rows } = await admin.query(
      "SELECT version_no, parent_version_id FROM document_versions WHERE id = $1",
      [second.versionId],
    );
    expect(rows[0]).toEqual({ version_no: 2, parent_version_id: first.versionId });
  });

  it("tenant B cannot read, list, upload to or complete tenant A's documents", async () => {
    const doc = await newDocument(owner);
    const p = { id: doc.documentId };
    expect((await call(documentRoute, "GET", { headers: otherTenant, params: p })).status).toBe(
      404,
    );
    expect((await call(versionsRoute, "GET", { headers: otherTenant, params: p })).status).toBe(
      404,
    );
    expect((await call(versionsRoute, "POST", { headers: otherTenant, params: p })).status).toBe(
      404,
    );
    const u = { id: doc.upload.id };
    const bytes = await pdfWithScript();
    expect(
      (await call(contentRoute, "PUT", { headers: otherTenant, params: u, body: bytes })).status,
    ).toBe(404);
    expect((await call(completeRoute, "POST", { headers: otherTenant, params: u })).status).toBe(
      404,
    );
    expect((await call(uploadRoute, "GET", { headers: otherTenant, params: u })).status).toBe(404);
    const list = await (await call(documentsRoute, "GET", { headers: otherTenant })).json();
    expect(list.documents.map((d: { id: string }) => d.id)).not.toContain(doc.documentId);
  });

  it("follows the permission catalogue for each workspace type", async () => {
    expect(
      (await call(documentsRoute, "POST", { headers: viewer, json: { title: "x" } })).status,
    ).toBe(403);
    expect(
      (await (await call(documentsRoute, "GET", { headers: viewer })).json()).documents,
    ).toEqual([]);
    expect(
      (await call(documentsRoute, "POST", { headers: employee, json: { title: "x" } })).status,
    ).toBe(403);
  });

  it("treats malformed ids as not found and validates bodies", async () => {
    expect(
      (await call(documentRoute, "GET", { headers: owner, params: { id: "1 OR 1=1" } })).status,
    ).toBe(404);
    expect(
      (await call(documentsRoute, "POST", { headers: owner, json: { title: "" } })).status,
    ).toBe(400);
  });
});
