import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { closeDb } from "@/db/client";
import { processUpload } from "@/documents/uploads";
import type { TenantContext } from "@/db/tenant";
import { MemoryObjectStore } from "@/storage/memory-store";
import { Storage } from "@/storage";
import { configureAppEnv, sessionFor } from "./auth-helpers";
import { connect } from "./helpers";

describe("background jobs re-check their tenant context", () => {
  let admin: Client;
  let a: TenantContext;
  let b: TenantContext;
  let uploadId: string;
  const storage = new Storage(new MemoryObjectStore(), new MemoryObjectStore());

  beforeAll(async () => {
    configureAppEnv(inject("appUrl"));
    admin = await connect("admin");
    const sa = await sessionFor(admin, "job-a@example.test", "PUBLIC_CUSTOMER", "CUSTOMER_OWNER");
    const sb = await sessionFor(admin, "job-b@example.test", "PUBLIC_CUSTOMER", "CUSTOMER_OWNER");
    a = { tenantId: sa.tenantId, workspaceType: "PUBLIC_CUSTOMER", userId: sa.userId };
    b = { tenantId: sb.tenantId, workspaceType: "PUBLIC_CUSTOMER", userId: sb.userId };

    await admin.query("BEGIN");
    await admin.query("SELECT set_config('app.tenant_id', $1, true)", [a.tenantId]);
    const doc = await admin.query<{ id: string }>(
      "INSERT INTO documents (tenant_id, public_id, title, owner_id) VALUES ($1, 'DOC-JOBTEST000', 'x', $2) RETURNING id",
      [a.tenantId, a.userId],
    );
    const up = await admin.query<{ id: string }>(
      `INSERT INTO uploads (tenant_id, document_id, storage_key, status, created_by)
       VALUES ($1, $2, 'k', 'UPLOADED', $3) RETURNING id`,
      [a.tenantId, doc.rows[0]!.id, a.userId],
    );
    await admin.query("COMMIT");
    uploadId = up.rows[0]!.id;
  });

  afterAll(async () => {
    await closeDb();
    await admin.end();
  });

  const status = async () =>
    (await admin.query("SELECT status FROM uploads WHERE id = $1", [uploadId])).rows[0].status;

  it("refuses an upload id from another tenant", async () => {
    await expect(processUpload(b, uploadId, storage)).rejects.toThrow(/upload not found in tenant/);
    expect(await status()).toBe("UPLOADED");
  });

  it("refuses a tenant id paired with a user who is not a member", async () => {
    await expect(processUpload({ ...a, userId: b.userId }, uploadId, storage)).rejects.toThrow(
      /not an active member/,
    );
    expect(await status()).toBe("UPLOADED");
  });

  it("refuses a workspace type that does not match the tenant", async () => {
    await expect(
      processUpload({ ...a, workspaceType: "COMPANY_MANAGED" }, uploadId, storage),
    ).rejects.toThrow(/tenant does not match/);
    expect(await status()).toBe("UPLOADED");
  });

  it("runs with the correct context", async () => {
    // The raw object is missing, so it is rejected cleanly, which proves the job ran.
    await expect(processUpload(a, uploadId, storage)).resolves.toMatchObject({
      status: "REJECTED",
    });
  });
});
