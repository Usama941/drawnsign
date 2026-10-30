import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { verifyChain } from "@/audit/chain";
import { closeDb } from "@/db/client";
import { anchorLedgers, appendAudit, loadChain } from "@/db/audit";
import { withTenant, type TenantContext } from "@/db/tenant";
import { route } from "@/server/route";
import { configureAppEnv, sessionFor } from "./auth-helpers";
import { connect } from "./helpers";

describe("audit ledger", () => {
  let admin: Client;
  let app: Client;
  let ctx: TenantContext;
  let other: TenantContext;
  let headers: Headers;

  beforeAll(async () => {
    configureAppEnv(inject("appUrl"));
    admin = await connect("admin");
    app = await connect("app");
    const s = await sessionFor(admin, "ledger@example.test", "PUBLIC_CUSTOMER", "CUSTOMER_OWNER");
    headers = s.headers;
    ctx = { tenantId: s.tenantId, workspaceType: "PUBLIC_CUSTOMER", userId: s.userId };
    const o = await sessionFor(admin, "ledger-b@example.test", "PUBLIC_CUSTOMER", "CUSTOMER_OWNER");
    other = { tenantId: o.tenantId, workspaceType: "PUBLIC_CUSTOMER", userId: o.userId };
  });

  afterAll(async () => {
    await closeDb();
    await app.end();
    await admin.end();
  });

  const append = (c: TenantContext, action: string) =>
    withTenant(c, (tx) =>
      appendAudit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action,
        objectType: "test",
        payload: { action },
      }),
    );

  it("builds a valid per-tenant chain, even under concurrent appends", async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => append(ctx, `concurrent-${i}`)));
    await append(other, "other-tenant");
    const chain = await withTenant(ctx, (tx) => loadChain(tx));
    expect(chain.map((r) => r.seq)).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 1)));
    expect(verifyChain(chain)).toEqual({ ok: true, length: 10 });
    const otherChain = await withTenant(other, (tx) => loadChain(tx));
    expect(otherChain.map((r) => r.action)).toEqual(["other-tenant"]);
    expect(verifyChain(otherChain).ok).toBe(true);
  });

  it("ignores hash fields sent by the app", async () => {
    await withTenant(ctx, (tx) =>
      tx.execute(
        `INSERT INTO audit_ledger (tenant_id, action, object_type, seq, payload_sha256, prev_hash, entry_hash)
         VALUES ('${ctx.tenantId}', 'forged', 'test', 999, 'x', 'y', 'z')` as never,
      ),
    );
    const chain = await withTenant(ctx, (tx) => loadChain(tx));
    expect(chain.at(-1)).toMatchObject({ action: "forged", seq: String(chain.length) });
    expect(verifyChain(chain).ok).toBe(true);
  });

  it("rejects UPDATE and DELETE from the app role", async () => {
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
    await expect(app.query("UPDATE audit_ledger SET action = 'x'")).rejects.toThrow(
      /permission denied/,
    );
    await app.query("ROLLBACK");
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
    await expect(app.query("DELETE FROM audit_ledger")).rejects.toThrow(/permission denied/);
    await app.query("ROLLBACK");
  });

  it("rejects UPDATE and DELETE even from the owner", async () => {
    await expect(admin.query("UPDATE audit_ledger SET action = 'x'")).rejects.toThrow(
      /insert-only/,
    );
    await expect(admin.query("DELETE FROM audit_ledger")).rejects.toThrow(/insert-only/);
    await expect(admin.query("TRUNCATE audit_ledger CASCADE")).rejects.toThrow(/insert-only/);
  });

  it("detects a past row edited by a superuser who bypasses the triggers", async () => {
    await admin.query("BEGIN");
    await admin.query("SET LOCAL session_replication_role = replica");
    await admin.query(
      `UPDATE audit_ledger SET payload = '{"tampered": true}'
       WHERE tenant_id = $1 AND seq = 3`,
      [ctx.tenantId],
    );
    await admin.query("COMMIT");
    const result = verifyChain(await withTenant(ctx, (tx) => loadChain(tx)));
    expect(result).toMatchObject({ ok: false, seq: "3", reason: "payload hash mismatch" });
  });

  it("a mutating route writes exactly one entry in its transaction", async () => {
    const before = (await withTenant(ctx, (tx) => loadChain(tx))).length;
    const handler = route({}, async ({ tx, audit }) => {
      await tx.execute(
        `UPDATE tenants SET name = 'renamed' WHERE id = current_tenant_id()` as never,
      );
      audit({ action: "tenant.rename", objectType: "tenant", details: { name: "renamed" } });
      return Response.json({ ok: true });
    });
    const res = await handler(
      new Request("http://localhost/api/v1/x", { method: "PATCH", headers }),
      {
        params: Promise.resolve({}),
      },
    );
    expect(res.status).toBe(200);
    const chain = await withTenant(ctx, (tx) => loadChain(tx));
    expect(chain.length).toBe(before + 1);
    expect(chain.at(-1)).toMatchObject({ action: "tenant.rename", objectType: "tenant" });
  });

  it("a failed mutating route rolls back its writes and writes no entry", async () => {
    const before = (await withTenant(ctx, (tx) => loadChain(tx))).length;
    const handler = route({}, async ({ tx }) => {
      await tx.execute(
        `UPDATE tenants SET name = 'should-not-stick' WHERE id = current_tenant_id()` as never,
      );
      return new Response("nope", { status: 422 });
    });
    const res = await handler(
      new Request("http://localhost/api/v1/x", { method: "POST", headers }),
      {
        params: Promise.resolve({}),
      },
    );
    expect(res.status).toBe(422);
    expect((await withTenant(ctx, (tx) => loadChain(tx))).length).toBe(before);
    const { rows } = await admin.query("SELECT name FROM tenants WHERE id = $1", [ctx.tenantId]);
    expect(rows[0].name).toBe("renamed");
  });

  it("read-only routes write no entry", async () => {
    const before = (await withTenant(ctx, (tx) => loadChain(tx))).length;
    const handler = route({}, async () => Response.json({}));
    await handler(new Request("http://localhost/api/v1/x", { headers }), {
      params: Promise.resolve({}),
    });
    expect((await withTenant(ctx, (tx) => loadChain(tx))).length).toBe(before);
  });

  it("anchors each tenant's chain head once per day", async () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(await anchorLedgers(today)).toBeGreaterThanOrEqual(2);
    expect(await anchorLedgers(today)).toBe(0);
    const anchors = await withTenant(ctx, (tx) =>
      tx.execute<{ last_seq: string; root_hash: string }>(
        "SELECT last_seq::text, root_hash FROM ledger_anchors" as never,
      ),
    );
    const chain = await withTenant(ctx, (tx) => loadChain(tx));
    expect(anchors.rows).toEqual([
      { last_seq: chain.at(-1)!.seq, root_hash: chain.at(-1)!.entryHash },
    ]);
  });

  it("the app role cannot read another tenant's ledger or anchors", async () => {
    const rows = await withTenant(other, (tx) => loadChain(tx));
    expect(rows.every((r) => r.action === "other-tenant")).toBe(true);
  });
});
