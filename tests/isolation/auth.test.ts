import { randomBytes } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { getAuth } from "@/auth/server";
import { resolveSession } from "@/auth/session";
import { closeDb } from "@/db/client";
import { MemoryMailer, setMailerForTests } from "@/lib/mail";
import { connect } from "./helpers";
import { totp } from "./totp";

const mailer = new MemoryMailer();
const password = `pw-${randomBytes(12).toString("hex")}`;

function cookieHeaders(res: Headers): Headers {
  const cookies = res
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return new Headers({ cookie: cookies });
}

async function signUpAndVerify(email: string): Promise<string> {
  const auth = getAuth();
  await auth.api.signUpEmail({ body: { email, password, name: email } });
  const mail = mailer.sent.findLast((m) => m.to === email);
  const token = new URL(/https?:\/\/\S+/.exec(mail!.text)![0]).searchParams.get("token")!;
  await auth.api.verifyEmail({ query: { token } });
  const { rows } = await admin.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [
    email,
  ]);
  return rows[0]!.id;
}

async function signIn(email: string) {
  return getAuth().api.signInEmail({ body: { email, password }, returnHeaders: true });
}

async function addMembership(userId: string, workspaceType: string, role: string) {
  const { rows } = await admin.query<{ id: string }>(
    "INSERT INTO tenants (name, workspace_type) VALUES ('auth test', $1) RETURNING id",
    [workspaceType],
  );
  const tenantId = rows[0]!.id;
  await admin.query(
    "INSERT INTO memberships (tenant_id, workspace_type, user_id, role) VALUES ($1, $2, $3, $4)",
    [tenantId, workspaceType, userId, role],
  );
  return tenantId;
}

let admin: Client;

describe("auth and session resolution", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = inject("appUrl");
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
    setMailerForTests(mailer);
    admin = await connect("admin");
  });

  afterAll(async () => {
    await closeDb();
    await admin.end();
  });

  it("does not sign in until the email address is verified", async () => {
    const email = "unverified@example.test";
    await getAuth().api.signUpEmail({ body: { email, password, name: "U" } });
    expect(mailer.sent.some((m) => m.to === email)).toBe(true);
    await expect(signIn(email)).rejects.toThrow();
  });

  it("resolves the tenant from the session and the membership, not from the request", async () => {
    const email = "owner@example.test";
    const userId = await signUpAndVerify(email);
    const tenantId = await addMembership(userId, "PUBLIC_CUSTOMER", "CUSTOMER_OWNER");

    const { headers } = await signIn(email);
    const session = await resolveSession(cookieHeaders(headers));
    expect(session?.tenant).toEqual({
      tenantId,
      workspaceType: "PUBLIC_CUSTOMER",
      role: "CUSTOMER_OWNER",
      teamScope: [],
      mfaSatisfied: true,
    });
  });

  it("drops the tenant when the membership is suspended", async () => {
    const email = "suspended@example.test";
    const userId = await signUpAndVerify(email);
    await addMembership(userId, "PUBLIC_CUSTOMER", "CUSTOMER_SENDER");
    const { headers } = await signIn(email);
    await admin.query("UPDATE memberships SET status = 'SUSPENDED' WHERE user_id = $1", [userId]);
    const session = await resolveSession(cookieHeaders(headers));
    expect(session?.userId).toBe(userId);
    expect(session?.tenant).toBeNull();
  });

  it("requires MFA for company managers: password-only sessions are not satisfied", async () => {
    const email = "manager@example.test";
    const userId = await signUpAndVerify(email);
    await addMembership(userId, "COMPANY_MANAGED", "COMPANY_MANAGER");

    const { headers } = await signIn(email);
    const before = await resolveSession(cookieHeaders(headers));
    expect(before?.tenant?.mfaSatisfied).toBe(false);

    // Enrol TOTP, then sign in again with the second factor.
    const auth = getAuth();
    const enrolled = await auth.api.enableTwoFactor({
      body: { password },
      headers: cookieHeaders(headers),
    });
    if (enrolled.method !== "totp") throw new Error("expected TOTP enrolment");
    const secret = new URL(enrolled.totpURI).searchParams.get("secret")!;
    await auth.api.verifyTOTP({ body: { code: totp(secret) }, headers: cookieHeaders(headers) });

    const first = await signIn(email);
    expect(first.response).toMatchObject({ twoFactorRedirect: true });
    const second = await auth.api.verifyTOTP({
      body: { code: totp(secret) },
      headers: cookieHeaders(first.headers),
      returnHeaders: true,
    });
    const after = await resolveSession(cookieHeaders(second.headers));
    expect(after?.tenant).toMatchObject({ role: "COMPANY_MANAGER", mfaSatisfied: true });
  });
});
