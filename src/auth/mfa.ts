// Better Auth endpoints that create a session only after a second factor has been proven.
const MFA_SESSION_PATHS = new Set([
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/passkey/verify-authentication",
]);

export function sessionCreatedWithMfa(path: string | undefined): boolean {
  return path !== undefined && MFA_SESSION_PATHS.has(path);
}

// COMPANY_MANAGED roles that must complete MFA before any permission is granted (PRD section 5).
export const MFA_REQUIRED_ROLES: ReadonlySet<string> = new Set([
  "COMPANY_ADMIN",
  "COMPANY_MANAGER",
]);
