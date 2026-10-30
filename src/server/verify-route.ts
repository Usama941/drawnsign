import { resolveSession, type AppSession } from "@/auth/session";
import { rateLimitHit } from "@/db/signing-lookup";
import { withTenant, type Tx } from "@/db/tenant";
import { lookupVerification, publicIdExists, type VerifyMatch } from "@/db/verify-lookup";
import { hashToken, PUBLIC_ID } from "@/documents/ids";
import { clientIp } from "@/signing/links";
import { problem } from "./problem";
import { tagRouter, type NextHandler, type WrappedHandler } from "./route";

export interface VerifyContext {
  req: Request;
  tx: Tx;
  match: VerifyMatch;
  viewer: AppSession | null;
}

const TOKEN = /^[A-Za-z0-9_-]{22}$/;

// Public verification (PRD section 12). No account needed. Without a valid token the caller
// learns only whether the public id exists. With one, the tenant comes from the token via
// verify_lookup() (CLAUDE.md rule 2) and every read runs inside withTenant(). Read-only.
export function verifyRoute(
  tokenFrom: (req: Request) => Promise<string | null>,
  handler: (ctx: VerifyContext) => Promise<Response>,
): WrappedHandler {
  const fn: NextHandler = async (req, ctx) => {
    const publicId = (await ctx?.params)?.publicId;
    if (typeof publicId !== "string" || !PUBLIC_ID.test(publicId))
      return Response.json({ exists: false });
    const ip = clientIp(req);
    const allowed =
      (await rateLimitHit(`verify:ip:${ip}`, 60, 60)) &&
      (await rateLimitHit(`verify:doc:${publicId}`, 300, 60));
    if (!allowed) return problem(429, "Too Many Requests");

    const token = await tokenFrom(req);
    const match =
      token && TOKEN.test(token) ? await lookupVerification(publicId, hashToken(token)) : null;
    if (!match) return Response.json({ exists: await publicIdExists(publicId) });

    const viewer = await resolveSession(req.headers);
    return withTenant(
      { tenantId: match.tenantId, workspaceType: match.workspaceType, userId: null },
      (tx) => handler({ req, tx, match, viewer }),
    );
  };
  return tagRouter(fn, "verify");
}
