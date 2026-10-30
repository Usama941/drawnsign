import { eq, sql } from "drizzle-orm";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { invitations, memberships, tenants } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import { connect } from "./helpers";

// Global tables that are deliberately not tenant-scoped.
const GLOBAL_TABLES = [
  "users",
  "workspace_roles",
  "sessions",
  "accounts",
  "verifications",
  "two_factors",
  "passkeys",
  "rate_limits",
  "dev_outbox",
];

describe("row-level security", () => {
  let admin: Client;
  let app: Client;
  let a: TenantContext;
  let b: TenantContext;

  beforeAll(async () => {
    process.env.DATABASE_URL = inject("appUrl");
    admin = await connect("admin");
    app = await connect("app");
    const t = await admin.query<{ id: string }>(
      `INSERT INTO tenants (name, workspace_type) VALUES
         ('RLS A', 'PUBLIC_CUSTOMER'), ('RLS B', 'PUBLIC_CUSTOMER') RETURNING id`,
    );
    const u = await admin.query<{ id: string }>(
      `INSERT INTO users (name, email) VALUES ('A', 'rls-a@example.test'), ('B', 'rls-b@example.test')
       RETURNING id`,
    );
    a = { tenantId: t.rows[0]!.id, workspaceType: "PUBLIC_CUSTOMER", userId: u.rows[0]!.id };
    b = { tenantId: t.rows[1]!.id, workspaceType: "PUBLIC_CUSTOMER", userId: u.rows[1]!.id };
    for (const ctx of [a, b]) {
      await admin.query(
        `INSERT INTO memberships (tenant_id, workspace_type, user_id, role)
         VALUES ($1, 'PUBLIC_CUSTOMER', $2, 'CUSTOMER_OWNER')`,
        [ctx.tenantId, ctx.userId],
      );
      await admin.query(
        `INSERT INTO invitations (tenant_id, workspace_type, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, 'PUBLIC_CUSTOMER', 'x@example.test', 'CUSTOMER_SENDER', $2, $3, now() + interval '1 day')`,
        [ctx.tenantId, `hash-${ctx.tenantId}`, ctx.userId],
      );
    }
  });

  afterAll(async () => {
    await closeDb();
    await app.end();
    await admin.end();
  });

  it("every table with tenant_id (and tenants) has RLS enabled, forced and a policy", async () => {
    const { rows } = await admin.query<{
      table: string;
      enabled: boolean;
      forced: boolean;
      policies: number;
    }>(`
      SELECT c.relname AS table, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND (c.relname = 'tenants' OR EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped))`);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) expect(r).toEqual({ ...r, enabled: true, forced: true });
    for (const r of rows) expect(r.policies, r.table).toBeGreaterThan(0);
  });

  it("every table without tenant_id is an explicitly global table", async () => {
    const { rows } = await admin.query<{ table: string }>(`
      SELECT c.relname AS table FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'tenants'
        AND NOT EXISTS (SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)`);
    for (const r of rows) expect(GLOBAL_TABLES, r.table).toContain(r.table);
  });

  it("every foreign key between tenant tables includes tenant_id on both sides", async () => {
    const { rows } = await admin.query<{ name: string; cols: string[]; refcols: string[] }>(`
      SELECT con.conname AS name,
        ARRAY(SELECT attname FROM pg_attribute WHERE attrelid = con.conrelid AND attnum = ANY(con.conkey))::text[] AS cols,
        ARRAY(SELECT attname FROM pg_attribute WHERE attrelid = con.confrelid AND attnum = ANY(con.confkey))::text[] AS refcols
      FROM pg_constraint con
      JOIN pg_class src ON src.oid = con.conrelid
      JOIN pg_class dst ON dst.oid = con.confrelid
      JOIN pg_namespace n ON n.oid = src.relnamespace
      WHERE con.contype = 'f' AND n.nspname = 'public'
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = src.oid AND attname = 'tenant_id')
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = dst.oid AND attname = 'tenant_id')`);
    for (const r of rows) {
      expect(r.cols, r.name).toContain("tenant_id");
      expect(r.refcols, r.name).toContain("tenant_id");
    }
  });

  it("the app role sees no tenant rows when app.tenant_id is unset", async () => {
    for (const table of ["tenants", "memberships", "invitations"]) {
      const { rows } = await app.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect({ table, n: rows[0].n }).toEqual({ table, n: 0 });
    }
  });

  it("withTenant only returns the session tenant's rows", async () => {
    const seen = await withTenant(a, async (tx) => ({
      tenants: await tx.select().from(tenants),
      memberships: await tx.select().from(memberships),
      invitations: await tx.select().from(invitations),
    }));
    expect(seen.tenants.map((r) => r.id)).toEqual([a.tenantId]);
    expect(seen.memberships.map((r) => r.tenantId)).toEqual([a.tenantId]);
    expect(seen.invitations.map((r) => r.tenantId)).toEqual([a.tenantId]);
  });

  it("tenant A cannot read tenant B's rows even when asking for them by id", async () => {
    const rows = await withTenant(a, (tx) =>
      tx.select().from(memberships).where(eq(memberships.tenantId, b.tenantId)),
    );
    expect(rows).toEqual([]);
  });

  it("tenant A cannot insert rows into tenant B", async () => {
    await expect(
      withTenant(a, (tx) =>
        tx.insert(memberships).values({
          tenantId: b.tenantId,
          workspaceType: "PUBLIC_CUSTOMER",
          userId: a.userId!,
          role: "CUSTOMER_VIEWER",
        }),
      ),
    ).rejects.toThrow();
  });

  it("tenant A cannot update tenant B's rows", async () => {
    const updated = await withTenant(a, (tx) =>
      tx
        .update(memberships)
        .set({ role: "CUSTOMER_VIEWER" })
        .where(eq(memberships.tenantId, b.tenantId))
        .returning(),
    );
    expect(updated).toEqual([]);
    const { rows } = await admin.query("SELECT role FROM memberships WHERE tenant_id = $1", [
      b.tenantId,
    ]);
    expect(rows).toEqual([{ role: "CUSTOMER_OWNER" }]);
  });

  it("tenant A cannot move its own row into tenant B", async () => {
    await expect(
      withTenant(a, (tx) =>
        tx.update(tenants).set({ name: "moved" }).where(eq(tenants.id, b.tenantId)).returning(),
      ),
    ).resolves.toEqual([]);
  });

  it("app.tenant_id does not leak to the next transaction on the same pool", async () => {
    await withTenant(a, async () => undefined);
    for (let i = 0; i < 5; i++) {
      const { rows } = await getDb().execute<{ t: string | null }>(
        sql`SELECT current_setting('app.tenant_id', true) AS t`,
      );
      expect(rows[0]?.t ?? "").toBe("");
    }
  });

  it("withTenant rejects a malformed tenant id", async () => {
    await expect(
      withTenant({ ...a, tenantId: "' OR 1=1 --" }, async () => undefined),
    ).rejects.toThrow(/invalid tenant context/);
  });
});
