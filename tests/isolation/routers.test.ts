import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { closeDb } from "@/db/client";
import { HTTP_METHODS, v1RouteFiles } from "../route-files";
import { configureAppEnv, sessionFor } from "./auth-helpers";
import { connect } from "./helpers";

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

async function companyHandlers(): Promise<{ file: string; method: string; handler: Handler }[]> {
  const out = [];
  for (const { file } of v1RouteFiles().filter((r) => r.kind === "company")) {
    const mod = (await import(file)) as Record<string, Handler>;
    for (const method of HTTP_METHODS) {
      if (mod[method]) out.push({ file, method, handler: mod[method] });
    }
  }
  return out;
}

function call(handler: Handler, method: string, headers?: Headers): Promise<Response> {
  const req = new Request("http://localhost:3000/api/v1/company/x", { method, headers });
  return handler(req, { params: Promise.resolve({}) });
}

describe("routers", () => {
  let admin: Client;
  let publicHeaders: Headers;
  let employeeHeaders: Headers;

  beforeAll(async () => {
    configureAppEnv(inject("appUrl"));
    admin = await connect("admin");
    publicHeaders = (
      await sessionFor(admin, "router-public@example.test", "PUBLIC_CUSTOMER", "CUSTOMER_OWNER")
    ).headers;
    employeeHeaders = (
      await sessionFor(admin, "router-employee@example.test", "COMPANY_MANAGED", "COMPANY_EMPLOYEE")
    ).headers;
  });

  afterAll(async () => {
    await closeDb();
    await admin.end();
  });

  it("a PUBLIC_CUSTOMER session gets 404 on every /api/v1/company handler", async () => {
    const handlers = await companyHandlers();
    expect(handlers.length).toBeGreaterThan(0);
    for (const { file, method, handler } of handlers) {
      const res = await call(handler, method, publicHeaders);
      expect({ file, method, status: res.status }).toEqual({ file, method, status: 404 });
    }
  });

  it("an anonymous caller gets 404 on every /api/v1/company handler", async () => {
    for (const { file, method, handler } of await companyHandlers()) {
      const res = await call(handler, method);
      expect({ file, method, status: res.status }).toEqual({ file, method, status: 404 });
    }
  });

  it("a COMPANY_MANAGED session reaches the company router", async () => {
    const { GET } = (await import("@/app/api/v1/company/me/route")) as unknown as { GET: Handler };
    const res = await call(GET, "GET", employeeHeaders);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: "COMPANY_EMPLOYEE" });
  });

  it("the shared router serves both workspace types and rejects anonymous callers", async () => {
    const { GET } = (await import("@/app/api/v1/me/route")) as unknown as { GET: Handler };
    expect((await call(GET, "GET")).status).toBe(401);
    expect(await (await call(GET, "GET", publicHeaders)).json()).toMatchObject({
      workspaceType: "PUBLIC_CUSTOMER",
    });
    expect(await (await call(GET, "GET", employeeHeaders)).json()).toMatchObject({
      workspaceType: "COMPANY_MANAGED",
    });
  });
});
