import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newPublicId } from "@/documents/ids";
import { connect } from "./helpers";

const SHA = "a".repeat(64);

describe("document tables", () => {
  let admin: Client;
  let app: Client;
  let tenantA: string;
  let tenantB: string;
  let companyTenant: string;
  let userId: string;

  async function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    try {
      return await fn();
    } finally {
      await app.query("ROLLBACK");
    }
  }

  async function createDocument(tenantId: string): Promise<string> {
    await admin.query("BEGIN");
    await admin.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO documents (tenant_id, public_id, title, owner_id) VALUES ($1, $2, 't', $3) RETURNING id",
      [tenantId, newPublicId(), userId],
    );
    await admin.query("COMMIT");
    return rows[0]!.id;
  }

  async function addVersion(tenantId: string, documentId: string, parent: string | null = null) {
    const { rows } = await admin.query<{ id: string; version_no: number }>(
      `INSERT INTO document_versions (tenant_id, document_id, version_no, parent_version_id, kind,
         storage_class, storage_key, sha256, size_bytes, page_count)
       VALUES ($1, $2, 0, $3, 'DRAFT', 'DRAFTS', 'k', $4, 1, 1) RETURNING id, version_no`,
      [tenantId, documentId, parent, SHA],
    );
    return rows[0]!;
  }

  beforeAll(async () => {
    admin = await connect("admin");
    app = await connect("app");
    const t = await admin.query<{ id: string; workspace_type: string }>(
      `INSERT INTO tenants (name, workspace_type) VALUES
         ('Docs A', 'PUBLIC_CUSTOMER'), ('Docs B', 'PUBLIC_CUSTOMER'), ('Docs C', 'COMPANY_MANAGED')
       RETURNING id, workspace_type`,
    );
    [tenantA, tenantB, companyTenant] = t.rows.map((r) => r.id) as [string, string, string];
    const u = await admin.query<{ id: string }>(
      "INSERT INTO users (name, email) VALUES ('Docs', 'docs@example.test') RETURNING id",
    );
    userId = u.rows[0]!.id;
  });

  afterAll(async () => {
    await app.end();
    await admin.end();
  });

  it("numbers versions per document and keeps parents inside the document", async () => {
    const doc = await createDocument(tenantA);
    const other = await createDocument(tenantA);
    const v1 = await addVersion(tenantA, doc);
    const v2 = await addVersion(tenantA, doc, v1.id);
    expect([v1.version_no, v2.version_no]).toEqual([1, 2]);
    await expect(addVersion(tenantA, other, v1.id)).rejects.toThrow(/another document/);
  });

  it("rejects a version or current_version that points across tenants", async () => {
    const docA = await createDocument(tenantA);
    const docB = await createDocument(tenantB);
    const vB = await addVersion(tenantB, docB);
    await expect(addVersion(tenantA, docB)).rejects.toThrow(/document_versions_document_fk/);
    await expect(
      admin.query("UPDATE documents SET current_version_id = $1 WHERE id = $2", [vB.id, docA]),
    ).rejects.toThrow(/documents_current_version_fk/);
  });

  it("document_versions is insert-only for the app role and the owner", async () => {
    const doc = await createDocument(tenantA);
    await addVersion(tenantA, doc);
    await asTenant(tenantA, async () => {
      await expect(app.query("UPDATE document_versions SET sha256 = $1", [SHA])).rejects.toThrow(
        /permission denied/,
      );
    });
    await asTenant(tenantA, async () => {
      await expect(app.query("DELETE FROM document_versions")).rejects.toThrow(/permission denied/);
    });
    await expect(admin.query("UPDATE document_versions SET page_count = 9")).rejects.toThrow(
      /insert-only/,
    );
  });

  it("only drafts live in the drafts store", async () => {
    const doc = await createDocument(tenantA);
    await expect(
      admin.query(
        `INSERT INTO document_versions (tenant_id, document_id, version_no, kind, storage_class,
           storage_key, sha256, size_bytes, page_count)
         VALUES ($1, $2, 0, 'DRAFT', 'EVIDENCE', 'k', $3, 1, 1)`,
        [tenantA, doc, SHA],
      ),
    ).rejects.toThrow(/storage_class_check/);
  });

  it("tenant A cannot see tenant B's documents, versions, uploads or tokens", async () => {
    const docB = await createDocument(tenantB);
    await addVersion(tenantB, docB);
    await asTenant(tenantA, async () => {
      for (const table of ["documents", "document_versions", "uploads", "verification_tokens"]) {
        const { rows } = await app.query(
          `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
          [tenantB],
        );
        expect({ table, n: rows[0].n }).toEqual({ table, n: 0 });
      }
    });
  });

  it("enforces the PRD section 8 lifecycle", async () => {
    const doc = await createDocument(tenantA);
    const set = (status: string) =>
      admin.query("UPDATE documents SET status = $1 WHERE id = $2", [status, doc]);
    await expect(set("COMPLETED")).rejects.toThrow(/cannot change from DRAFT to COMPLETED/);
    await set("SENT");
    await set("COMPLETED");
    await expect(set("SENT")).rejects.toThrow(/cannot change/);
    await expect(set("AMENDED")).rejects.toThrow(/not permitted for this workspace type/);
  });

  it("allows AMENDED only for company-managed documents, and blocks deletion under legal hold", async () => {
    const doc = await createDocument(companyTenant);
    for (const s of ["SENT", "COMPLETED", "AMENDED", "ARCHIVED"]) {
      await admin.query("UPDATE documents SET status = $1 WHERE id = $2", [s, doc]);
    }
    await admin.query("UPDATE documents SET legal_hold = true WHERE id = $1", [doc]);
    await expect(
      admin.query("UPDATE documents SET status = 'DELETED' WHERE id = $1", [doc]),
    ).rejects.toThrow(/legal hold/);
  });
});
