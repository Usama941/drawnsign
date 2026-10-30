import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./client";
import { memberships, type WorkspaceType } from "./schema";

export interface ActiveMembership {
  tenantId: string;
  workspaceType: WorkspaceType;
  role: string;
  teamScope: string[];
}

// Re-checks that the user still has an ACTIVE membership in the tenant stored on their
// session. Runs under RLS with app.tenant_id set to that tenant.
export async function findActiveMembership(
  userId: string,
  tenantId: string,
): Promise<ActiveMembership | null> {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.tenant_id', ${tenantId}, true),
                 set_config('app.user_id', ${userId}, true)`,
    );
    const rows = await tx
      .select({
        tenantId: memberships.tenantId,
        workspaceType: memberships.workspaceType,
        role: memberships.role,
        teamScope: memberships.teamScope,
      })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "ACTIVE")));
    return rows[0] ?? null;
  });
}

// The user's own ACTIVE memberships across tenants (own_memberships policy; app.tenant_id unset).
export async function listOwnMemberships(userId: string): Promise<ActiveMembership[]> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return tx
      .select({
        tenantId: memberships.tenantId,
        workspaceType: memberships.workspaceType,
        role: memberships.role,
        teamScope: memberships.teamScope,
      })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "ACTIVE")));
  });
}
