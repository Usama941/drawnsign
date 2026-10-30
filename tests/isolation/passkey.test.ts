import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { getAuth } from "@/auth/server";
import { resolveSession } from "@/auth/session";
import { closeDb } from "@/db/client";
import {
  addMembership,
  configureAppEnv,
  cookieHeaders,
  signIn,
  signUpAndVerify,
} from "./auth-helpers";
import { connect } from "./helpers";
import { SoftwareAuthenticator } from "./webauthn";

const ORIGIN = "http://localhost:3000";

function merge(...sets: Headers[]): Headers {
  const cookies = sets
    .map((h) => h.get("cookie"))
    .filter(Boolean)
    .join("; ");
  return new Headers({ cookie: cookies, origin: ORIGIN });
}

describe("passkey sign-in as MFA", () => {
  let admin: Client;
  let userId: string;
  const email = "passkey-manager@example.test";
  const authenticator = new SoftwareAuthenticator("localhost", ORIGIN);

  beforeAll(async () => {
    configureAppEnv(inject("appUrl"));
    admin = await connect("admin");
    userId = await signUpAndVerify(admin, email);
    await addMembership(admin, userId, "COMPANY_MANAGED", "COMPANY_MANAGER");

    // Register a passkey from a password session.
    const auth = getAuth();
    const session = cookieHeaders((await signIn(email)).headers);
    const reg = await auth.api.generatePasskeyRegistrationOptions({
      headers: session,
      returnHeaders: true,
    });
    const headers = merge(session, cookieHeaders(reg.headers));
    await auth.api.verifyPasskeyRegistration({
      headers,
      body: { response: authenticator.register(reg.response) },
    });
  });

  afterAll(async () => {
    await closeDb();
    await admin.end();
  });

  async function passkeySignIn(userVerified: boolean) {
    const auth = getAuth();
    const opts = await auth.api.generatePasskeyAuthenticationOptions({
      headers: new Headers({ origin: ORIGIN }),
      returnHeaders: true,
    });
    const result = await auth.api.verifyPasskeyAuthentication({
      headers: merge(cookieHeaders(opts.headers)),
      body: { response: authenticator.authenticate(opts.response, userId, userVerified) },
      returnHeaders: true,
    });
    return resolveSession(cookieHeaders(result.headers));
  }

  it("a passkey sign-in with user verification satisfies MFA for a company manager", async () => {
    const session = await passkeySignIn(true);
    expect(session?.userId).toBe(userId);
    expect(session?.tenant).toMatchObject({ role: "COMPANY_MANAGER", mfaSatisfied: true });
  });

  it("a passkey sign-in without user verification does not", async () => {
    const session = await passkeySignIn(false);
    expect(session?.userId).toBe(userId);
    expect(session?.tenant?.mfaSatisfied).toBe(false);
  });

  it("a password-only sign-in by the same user still does not", async () => {
    const session = await resolveSession(cookieHeaders((await signIn(email)).headers));
    expect(session?.tenant?.mfaSatisfied).toBe(false);
  });
});
