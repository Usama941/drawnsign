import { randomBytes } from "node:crypto";
import type { Client } from "pg";
import { getAuth } from "@/auth/server";
import { MemoryMailer, setMailerForTests } from "@/lib/mail";

export const mailer = new MemoryMailer();
export const password = `pw-${randomBytes(12).toString("hex")}`;

// Points the app code at the test database as the app role, with per-run secrets.
export function configureAppEnv(appUrl: string): void {
  process.env.DATABASE_URL = appUrl;
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.BETTER_AUTH_SECRET ??= randomBytes(32).toString("hex");
  setMailerForTests(mailer);
}

export function cookieHeaders(res: Headers): Headers {
  const cookies = res
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return new Headers({ cookie: cookies });
}

export async function signUpAndVerify(admin: Client, email: string): Promise<string> {
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

export async function signIn(email: string) {
  return getAuth().api.signInEmail({ body: { email, password }, returnHeaders: true });
}

export async function addMembership(
  admin: Client,
  userId: string,
  workspaceType: "COMPANY_MANAGED" | "PUBLIC_CUSTOMER",
  role: string,
): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    "INSERT INTO tenants (name, workspace_type) VALUES ('test tenant', $1) RETURNING id",
    [workspaceType],
  );
  const tenantId = rows[0]!.id;
  await admin.query(
    "INSERT INTO memberships (tenant_id, workspace_type, user_id, role) VALUES ($1, $2, $3, $4)",
    [tenantId, workspaceType, userId, role],
  );
  return tenantId;
}

// Signs up a verified user with one membership and returns cookie headers for their session.
export async function sessionFor(
  admin: Client,
  email: string,
  workspaceType: "COMPANY_MANAGED" | "PUBLIC_CUSTOMER",
  role: string,
): Promise<{ userId: string; tenantId: string; headers: Headers }> {
  const userId = await signUpAndVerify(admin, email);
  const tenantId = await addMembership(admin, userId, workspaceType, role);
  const { headers } = await signIn(email);
  return { userId, tenantId, headers: cookieHeaders(headers) };
}
