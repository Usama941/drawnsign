// The app's public base URL: APP_URL or BETTER_AUTH_URL when set; on Vercel, the stable
// branch URL of the deployment (so preview links work without configuration); else localhost.
export function appBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.APP_URL || env.BETTER_AUTH_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = env.VERCEL_BRANCH_URL || env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

// Origins Better Auth accepts requests from: the base URL plus this deployment's own URLs.
export function trustedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const hosts = [env.VERCEL_URL, env.VERCEL_BRANCH_URL].filter(Boolean).map((h) => `https://${h}`);
  return [...new Set([appBaseUrl(env), ...hosts])];
}
