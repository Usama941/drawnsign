// Better Auth endpoints that create a session only after a second factor has been proven.
const SECOND_FACTOR_PATHS = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code"]);
const PASSKEY_SIGN_IN_PATH = "/passkey/verify-authentication";

// A passkey counts as MFA only when the authenticator verified the user (PIN or biometric),
// i.e. the UV flag (bit 2 of the flags byte at offset 32 of authenticatorData) is set.
// Better Auth itself accepts passkeys without user verification.
export function sessionCreatedWithMfa(path: string | undefined, body?: unknown): boolean {
  if (path === undefined) return false;
  if (SECOND_FACTOR_PATHS.has(path)) return true;
  if (path === PASSKEY_SIGN_IN_PATH) return passkeyUserVerified(body);
  return false;
}

function passkeyUserVerified(body: unknown): boolean {
  const authenticatorData = (body as { response?: { response?: { authenticatorData?: unknown } } })
    ?.response?.response?.authenticatorData;
  if (typeof authenticatorData !== "string") return false;
  const bytes = Buffer.from(authenticatorData, "base64url");
  return bytes.length > 32 && (bytes[32]! & 0x04) !== 0;
}

// COMPANY_MANAGED roles that must complete MFA before any permission is granted (PRD section 5).
export const MFA_REQUIRED_ROLES: ReadonlySet<string> = new Set([
  "COMPANY_ADMIN",
  "COMPANY_MANAGER",
]);
