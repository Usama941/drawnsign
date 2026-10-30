// CLAUDE.md rule 9: a development seal must never reach real users. SEAL_MODE=development is
// refused in a Vercel production deployment, and on the production domain (PRODUCTION_HOSTNAME)
// wherever the app runs. Checked at build (next.config.ts), at server start
// (src/instrumentation.ts) and per request before sealing (pass the request host).
type Env = Record<string, string | undefined>;

export function sealModeViolation(env: Env, requestHost?: string): string | null {
  if (env.SEAL_MODE !== "development") return null;
  if (env.VERCEL_ENV === "production") {
    return "SEAL_MODE=development is not allowed in a Vercel production deployment";
  }
  const prod = env.PRODUCTION_HOSTNAME?.trim().toLowerCase();
  const host = requestHost?.split(":")[0]?.trim().toLowerCase();
  if (prod && host && (host === prod || host.endsWith(`.${prod}`))) {
    return `SEAL_MODE=development is not allowed on the production domain ${prod}`;
  }
  return null;
}

export function assertSealModeAllowed(env: Env = process.env, requestHost?: string): void {
  const violation = sealModeViolation(env, requestHost);
  if (violation) throw new Error(violation);
}
