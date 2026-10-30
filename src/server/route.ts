import { can, type Permission } from "@/auth/permissions";
import { resolveSession, tenantContext, type AppSession, type TenantSession } from "@/auth/session";
import { appendAudit } from "@/db/audit";
import { withTenant, type Tx } from "@/db/tenant";
import { forbidden, notFound, unauthorized } from "./problem";

export type TenantAppSession = AppSession & { tenant: TenantSession };

export interface AuditInfo {
  action?: string;
  objectType?: string;
  objectId?: string | null;
  details?: Record<string, unknown>;
}

export interface RouteContext {
  req: Request;
  session: TenantAppSession;
  tx: Tx;
  // Path params are resource ids only. The tenant always comes from the session.
  params: Record<string, string | string[]>;
  // Describes the audit entry written for mutating requests. Never put secrets or document
  // content in details.
  audit(info: AuditInfo): void;
}

export interface RouteOptions {
  permission?: Permission;
}

type NextHandler = (
  req: Request,
  ctx: { params: Promise<Record<string, string | string[]>> },
) => Promise<Response>;

export const ROUTER = Symbol.for("drawnsign.router");
export type RouterKind = "v1" | "company";
export type WrappedHandler = NextHandler & { [ROUTER]: RouterKind };

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Thrown inside the transaction so a non-2xx response rolls back everything the handler wrote.
class Rollback extends Error {
  constructor(readonly response: Response) {
    super("rollback");
  }
}

function wrap(
  kind: RouterKind,
  options: RouteOptions,
  handler: (ctx: RouteContext) => Promise<Response>,
): WrappedHandler {
  const fn: NextHandler = async (req, ctx) => {
    const session = await resolveSession(req.headers);

    // The company router does not exist for anyone outside a COMPANY_MANAGED tenant:
    // anonymous, tenant-less and PUBLIC_CUSTOMER callers all get 404 (CLAUDE.md rule 4).
    if (kind === "company" && session?.tenant?.workspaceType !== "COMPANY_MANAGED") {
      return notFound();
    }
    if (!session) return unauthorized();
    if (!session.tenant) return forbidden();
    if (options.permission && !can(session, options.permission)) return forbidden();

    const tenantSession = session as TenantAppSession;
    const params = (await ctx?.params) ?? {};
    const mutating = !READ_ONLY_METHODS.has(req.method);
    const audit: AuditInfo = {};

    try {
      return await withTenant(tenantContext(tenantSession), async (tx) => {
        const res = await handler({
          req,
          session: tenantSession,
          tx,
          params,
          audit: (info) => Object.assign(audit, info),
        });
        if (!res.ok) throw new Rollback(res);
        // Every mutating call writes one audit entry in the same transaction (CLAUDE.md rule 7).
        if (mutating) {
          await appendAudit(tx, {
            tenantId: tenantSession.tenant.tenantId,
            actorId: tenantSession.userId,
            action: audit.action ?? `${req.method} ${new URL(req.url).pathname}`,
            objectType: audit.objectType ?? "request",
            objectId: audit.objectId ?? null,
            payload: { method: req.method, status: res.status, ...audit.details },
          });
        }
        return res;
      });
    } catch (err) {
      if (err instanceof Rollback) return err.response;
      throw err;
    }
  };
  return Object.assign(fn, { [ROUTER]: kind });
}

// Handlers under /api/v1 (both workspace types).
export function route(
  options: RouteOptions,
  handler: (ctx: RouteContext) => Promise<Response>,
): WrappedHandler {
  return wrap("v1", options, handler);
}

// Handlers under /api/v1/company. Returns 404 unless the session is in a COMPANY_MANAGED tenant.
export function companyRoute(
  options: RouteOptions & { permission?: Extract<Permission, `company.${string}`> },
  handler: (ctx: RouteContext) => Promise<Response>,
): WrappedHandler {
  return wrap("company", options, handler);
}
