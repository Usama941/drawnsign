import { can, type Permission } from "@/auth/permissions";
import { resolveSession, tenantContext, type AppSession, type TenantSession } from "@/auth/session";
import { withTenant, type Tx } from "@/db/tenant";
import { forbidden, notFound, unauthorized } from "./problem";

export type TenantAppSession = AppSession & { tenant: TenantSession };

export interface RouteContext {
  req: Request;
  session: TenantAppSession;
  tx: Tx;
  // Path params are resource ids only. The tenant always comes from the session.
  params: Record<string, string | string[]>;
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
    return withTenant(tenantContext(tenantSession), (tx) =>
      handler({ req, session: tenantSession, tx, params }),
    );
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
