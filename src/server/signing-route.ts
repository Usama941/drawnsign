import { lookupSigningToken, rateLimitHit } from "@/db/signing-lookup";
import type { TenantContext, Tx } from "@/db/tenant";
import { hashToken } from "@/documents/ids";
import { clientIp } from "@/signing/links";
import { executeInTenant, type ExecutionHooks } from "./execute";
import { notFound, problem } from "./problem";
import { tagRouter, type NextHandler, type WrappedHandler } from "./route";

export interface SignerContext extends ExecutionHooks {
  req: Request;
  tx: Tx;
  tenant: TenantContext;
  envelopeId: string;
  recipientId: string;
}

const TOKEN = /^[A-Za-z0-9_-]{22}$/;

// Handlers under /api/v1/sign/{token}. External signers have no account: the signing token is
// their credential (CLAUDE.md rule 2). It is rate-limited, hashed, and resolved server-side by
// signing_lookup() to one tenant and one recipient; the tenant is never read from the request.
// Everything after that runs inside withTenant() for that tenant.
export function signingRoute(handler: (ctx: SignerContext) => Promise<Response>): WrappedHandler {
  const fn: NextHandler = async (req, ctx) => {
    const token = (await ctx?.params)?.token;
    if (typeof token !== "string" || !TOKEN.test(token)) return notFound();
    const tokenHash = hashToken(token);

    const ip = clientIp(req);
    const allowed =
      (await rateLimitHit(`sign:token:${tokenHash}`, 60, 60)) &&
      (await rateLimitHit(`sign:ip:${ip}`, 300, 60));
    if (!allowed) return problem(429, "Too Many Requests");

    const match = await lookupSigningToken(tokenHash);
    if (!match) return notFound();

    const tenant: TenantContext = {
      tenantId: match.tenantId,
      workspaceType: match.workspaceType,
      userId: null,
    };
    return executeInTenant(
      req,
      tenant,
      { actorId: null, details: { recipientId: match.recipientId } },
      (tx, hooks) =>
        handler({
          req,
          tx,
          tenant,
          envelopeId: match.envelopeId,
          recipientId: match.recipientId,
          ...hooks,
        }),
    );
  };
  return tagRouter(fn, "signing");
}
