import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect } from "./helpers";

describe("tenancy constraints", () => {
  let admin: Client;
  let companyId: string;
  let publicId: string;
  let userId: string;

  beforeAll(async () => {
    admin = await connect("admin");
    const t = await admin.query<{ id: string; workspace_type: string }>(
      `INSERT INTO tenants (name, workspace_type) VALUES
         ('T3 Company', 'COMPANY_MANAGED'), ('T3 Public', 'PUBLIC_CUSTOMER')
       RETURNING id, workspace_type`,
    );
    companyId = t.rows.find((r) => r.workspace_type === "COMPANY_MANAGED")!.id;
    publicId = t.rows.find((r) => r.workspace_type === "PUBLIC_CUSTOMER")!.id;
    const u = await admin.query<{ id: string }>(
      "INSERT INTO users (name, email) VALUES ('T3 User', 't3@example.test') RETURNING id",
    );
    userId = u.rows[0]!.id;
  });

  afterAll(async () => {
    await admin.end();
  });

  it("rejects changing a tenant's workspace_type, even as superuser", async () => {
    await expect(
      admin.query("UPDATE tenants SET workspace_type = 'PUBLIC_CUSTOMER' WHERE id = $1", [
        companyId,
      ]),
    ).rejects.toThrow(/workspace_type is immutable/);
  });

  it("allows other tenant columns to change", async () => {
    await admin.query("UPDATE tenants SET name = 'T3 Company Renamed' WHERE id = $1", [companyId]);
  });

  it("app_role cannot update workspace_type at all (column grant)", async () => {
    const { rows } = await admin.query(
      "SELECT has_column_privilege('app_role', 'tenants', 'workspace_type', 'UPDATE') AS allowed",
    );
    expect(rows[0].allowed).toBe(false);
  });

  it("rejects a membership role from the other workspace type's catalogue", async () => {
    await expect(
      admin.query(
        `INSERT INTO memberships (tenant_id, workspace_type, user_id, role)
         VALUES ($1, 'PUBLIC_CUSTOMER', $2, 'COMPANY_ADMIN')`,
        [publicId, userId],
      ),
    ).rejects.toThrow(/memberships_role_fk/);
  });

  it("rejects a membership whose workspace_type does not match its tenant", async () => {
    await expect(
      admin.query(
        `INSERT INTO memberships (tenant_id, workspace_type, user_id, role)
         VALUES ($1, 'PUBLIC_CUSTOMER', $2, 'CUSTOMER_OWNER')`,
        [companyId, userId],
      ),
    ).rejects.toThrow(/memberships_tenant_fk/);
  });

  it("accepts a role from the tenant's own catalogue", async () => {
    await admin.query(
      `INSERT INTO memberships (tenant_id, workspace_type, user_id, role)
       VALUES ($1, 'COMPANY_MANAGED', $2, 'COMPANY_ADMIN')`,
      [companyId, userId],
    );
  });

  it("app_role cannot add roles to the catalogue", async () => {
    const { rows } = await admin.query(
      "SELECT has_table_privilege('app_role', 'workspace_roles', 'INSERT') AS allowed",
    );
    expect(rows[0].allowed).toBe(false);
  });
});
