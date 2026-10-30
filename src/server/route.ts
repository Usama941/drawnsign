import { can, type Permission } from "@/auth/permissions";
import { resolveSession, tenantContext, type AppSession, type TenantSession } from "@/auth/session";
import type { WorkspaceType } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { executeInTenant, type ExecutionHooks } from "./execute";
import { forbidden, notFound, unauthorized } from "./problem";

export type { AuditInfo } from "./execute";

export type TenantAppSession = AppSession & { tenant: TenantSession };

export interface RouteContext extends ExecutionHooks {
  req: Request;
  session: TenantAppSession;
  tx: Tx;
  // Path params are resource ids only. The tenant always comes from the session.
  params: Record<string, string | string[]>;
}

// A single permission, or one per workspace type for shared routes whose catalogues name the
// same action differently.
export type RoutePermission = Permission | Partial<Record<WorkspaceType, Permission>>;

export interface RouteOptions {
  permission?: RoutePermission;
}

export type NextHandler = (
  req: Request,
  ctx: { params: Promise<Record<string, string | string[]>> },
) => Promise<Response>;

export const ROUTER = Symbol.for("drawnsign.router");
export type RouterKind = "v1" | "company" | "signing";
export type WrappedHandler = NextHandler & { [ROUTER]: RouterKind };

function permissionFor(p: RoutePermission, type: WorkspaceType): Permission | undefined {
  return typeof p === "string" ? p : p[type];
}

export function tagRouter(fn: NextHandler, kind: RouterKind): WrappedHandler {
  return Object.assign(fn, { [ROUTER]: kind });
}

function wrap(
  kind: "v1" | "company",
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
    if (options.permission) {
      const permission = permissionFor(options.permission, session.tenant.workspaceType);
      if (!permission || !can(session, permission)) return forbidden();
    }

    const tenantSession = session as TenantAppSession;
    const params = (await ctx?.params) ?? {};
    return executeInTenant(
      req,
      tenantContext(tenantSession),
      { actorId: tenantSession.userId },
      (tx, hooks) => handler({ req, session: tenantSession, tx, params, ...hooks }),
    );
  };
  return tagRouter(fn, kind);
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
