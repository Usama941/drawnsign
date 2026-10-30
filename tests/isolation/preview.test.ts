import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { resolveSession } from "@/auth/session";
import { closeDb } from "@/db/client";
import { OutboxMailer } from "@/lib/mail";
import { ensureAppUser } from "../../db/migrate";
import { configureAppEnv, cookieHeaders, signIn, signUpAndVerify } from "./auth-helpers";
import { connect } from "./helpers";
import { call } from "./http";

const outboxRoute = import("@/app/api/dev/outbox/route");
const workspaceRoute = import("@/app/api/preview/workspace/route");
const KEY = randomBytes(16).toString("hex");

describe("preview tooling", () => {
  let admin: Client;

  beforeAll(async () => {
    configureAppEnv(inject("appUrl"));
    admin = await connect("admin");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    process.env.SEAL_MODE = "development";
  });
  afterAll(async () => {
    await closeDb();
    await admin.end();
  });

  it("the outbox is off by default, needs the passphrase, and never runs on Vercel production", async () => {
    expect((await call(outboxRoute, "GET")).status).toBe(404);
    vi.stubEnv("EMAIL_MODE", "outbox");
    vi.stubEnv("DEV_OUTBOX_KEY", KEY);
    await new OutboxMailer().send({ to: "o@example.test", subject: "Your code", text: "123456" });
    expect(
      (await call(outboxRoute, "GET", { headers: new Headers({ "x-outbox-key": "wrong" }) }))
        .status,
    ).toBe(401);
    const ok = await call(outboxRoute, "GET", { headers: new Headers({ "x-outbox-key": KEY }) });
    expect((await ok.json()).mail[0]).toMatchObject({ to: "o@example.test", subject: "Your code" });
    vi.stubEnv("VERCEL_ENV", "production");
    expect(
      (await call(outboxRoute, "GET", { headers: new Headers({ "x-outbox-key": KEY }) })).status,
    ).toBe(404);
  });

  it("a signed-in user without a workspace can create one test workspace, only on previews", async () => {
    const email = "preview-user@example.test";
    await signUpAndVerify(admin, email);
    const headers = cookieHeaders((await signIn(email)).headers);
    expect((await resolveSession(headers))?.tenant).toBeNull();

    expect((await call(workspaceRoute, "POST", { headers, json: { name: "Test" } })).status).toBe(
      404,
    );
    vi.stubEnv("PREVIEW_SELF_SIGNUP", "true");
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await call(workspaceRoute, "POST", { headers, json: { name: "Test" } })).status).toBe(
      404,
    );
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await call(workspaceRoute, "POST", { json: { name: "Test" } })).status).toBe(401);
    expect((await call(workspaceRoute, "POST", { headers, json: { name: "Test" } })).status).toBe(
      201,
    );
    expect((await resolveSession(headers))?.tenant).toMatchObject({
      workspaceType: "PUBLIC_CUSTOMER",
      role: "CUSTOMER_OWNER",
    });
    expect((await call(workspaceRoute, "POST", { headers, json: { name: "Again" } })).status).toBe(
      409,
    );
    const audit = await admin.query(
      "SELECT count(*)::int AS n FROM audit_ledger WHERE action = 'tenant.created_preview'",
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it("the build creates the app_user login role as a member of app_role only", async () => {
    const password = randomBytes(24).toString("base64url");
    await ensureAppUser(inject("adminUrl"), password);
    await ensureAppUser(inject("adminUrl"), password); // idempotent
    const { rows } = await admin.query(
      `SELECT rolcanlogin, rolsuper, rolbypassrls, pg_has_role('app_user', 'app_role', 'MEMBER') AS member
       FROM pg_roles WHERE rolname = 'app_user'`,
    );
    expect(rows).toEqual([
      { rolcanlogin: true, rolsuper: false, rolbypassrls: false, member: true },
    ]);
    const url = new URL(inject("adminUrl"));
    url.username = "app_user";
    url.password = password;
    const app = new Client({ connectionString: url.toString() });
    await app.connect();
    expect((await app.query("SELECT count(*)::int AS n FROM tenants")).rows[0].n).toBe(0);
    await app.end();
  });
});
