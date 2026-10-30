import { describe, expect, it } from "vitest";
import { sessionCreatedWithMfa } from "./mfa";

function passkeyBody(flags: number) {
  const authData = Buffer.alloc(37);
  authData[32] = flags;
  return { response: { response: { authenticatorData: authData.toString("base64url") } } };
}

describe("sessionCreatedWithMfa", () => {
  it.each(["/two-factor/verify-totp", "/two-factor/verify-backup-code"])(
    "treats %s as MFA",
    (path) => expect(sessionCreatedWithMfa(path)).toBe(true),
  );

  it("treats a passkey sign-in as MFA only with user verification", () => {
    expect(sessionCreatedWithMfa("/passkey/verify-authentication", passkeyBody(0x05))).toBe(true);
    expect(sessionCreatedWithMfa("/passkey/verify-authentication", passkeyBody(0x01))).toBe(false);
    expect(sessionCreatedWithMfa("/passkey/verify-authentication", {})).toBe(false);
  });

  it.each([
    "/sign-in/email",
    "/sign-up/email",
    "/verify-email",
    "/passkey/verify-registration",
    undefined,
  ])("does not treat %s as MFA", (path) => expect(sessionCreatedWithMfa(path)).toBe(false));
});
