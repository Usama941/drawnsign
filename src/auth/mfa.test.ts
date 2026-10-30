import { describe, expect, it } from "vitest";
import { sessionCreatedWithMfa } from "./mfa";

describe("sessionCreatedWithMfa", () => {
  it.each([
    "/two-factor/verify-totp",
    "/two-factor/verify-backup-code",
    "/passkey/verify-authentication",
  ])("treats %s as MFA", (path) => expect(sessionCreatedWithMfa(path)).toBe(true));

  it.each(["/sign-in/email", "/sign-up/email", "/verify-email", undefined])(
    "does not treat %s as MFA",
    (path) => expect(sessionCreatedWithMfa(path)).toBe(false),
  );
});
