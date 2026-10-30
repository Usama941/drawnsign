import { appBaseUrl } from "./base-url";

type Env = Record<string, string | undefined>;

// Preview-only conveniences. Always off on Vercel production deployments and on the
// production domain, whatever the environment variables say.
function isProduction(env: Env): boolean {
  if (env.VERCEL_ENV === "production") return true;
  const prod = env.PRODUCTION_HOSTNAME?.trim().toLowerCase();
  return !!prod && new URL(appBaseUrl(env)).hostname.toLowerCase() === prod;
}

// EMAIL_MODE=outbox: emails are stored in dev_outbox and read at /dev/outbox.
export function outboxEnabled(env: Env = process.env): boolean {
  return env.EMAIL_MODE === "outbox" && !isProduction(env);
}

// PREVIEW_SELF_SIGNUP=true: a signed-in user with no workspace can create a test
// PUBLIC_CUSTOMER workspace for themselves.
export function selfSignupEnabled(env: Env = process.env): boolean {
  return env.PREVIEW_SELF_SIGNUP === "true" && !isProduction(env);
}
