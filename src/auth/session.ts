import { findActiveMembership } from "@/db/memberships";
import type { WorkspaceType } from "@/db/schema";
import type { TenantContext } from "@/db/tenant";
import { MFA_REQUIRED_ROLES } from "./mfa";
import { getAuth } from "./server";

export interface TenantSession {
  tenantId: string;
  workspaceType: WorkspaceType;
  role: string;
  teamScope: string[];
  // False for company admins/managers whose session was not created with a second factor.
  mfaSatisfied: boolean;
}

export interface AppSession {
  userId: string;
  email: string;
  tenant: TenantSession | null;
}

// Resolves the caller from the session cookie only. The tenant is the one stored on the
// session server-side, re-checked against an ACTIVE membership on every request.
export async function resolveSession(headers: Headers): Promise<AppSession | null> {
  const result = await getAuth().api.getSession({ headers });
  if (!result) return null;
  const { user, session } = result;
  const base = { userId: user.id, email: user.email };

  const activeTenantId = session.activeTenantId;
  if (typeof activeTenantId !== "string" || activeTenantId === "") return { ...base, tenant: null };

  const membership = await findActiveMembership(user.id, activeTenantId);
  if (!membership) return { ...base, tenant: null };

  return {
    ...base,
    tenant: {
      ...membership,
      mfaSatisfied: !MFA_REQUIRED_ROLES.has(membership.role) || session.mfaVerified === true,
    },
  };
}

export function tenantContext(session: AppSession & { tenant: TenantSession }): TenantContext {
  return {
    tenantId: session.tenant.tenantId,
    workspaceType: session.tenant.workspaceType,
    userId: session.userId,
  };
}
