import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { appendAudit } from "./audit";
import { getDb } from "./client";
import { memberships, sessions, tenants } from "./schema";

// Preview-only self-service workspace: a PUBLIC_CUSTOMER tenant owned by the caller. The
// tenant id is generated here, never taken from the request. Callers must check
// selfSignupEnabled() and that the user has no membership yet.
export async function createPreviewWorkspace(userId: string, name: string): Promise<string> {
  const tenantId = randomUUID();
  await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', ${userId}, true)`,
    );
    await tx.insert(tenants).values({ id: tenantId, name, workspaceType: "PUBLIC_CUSTOMER" });
    await tx.insert(memberships).values({
      tenantId,
      workspaceType: "PUBLIC_CUSTOMER",
      userId,
      role: "CUSTOMER_OWNER",
    });
    await appendAudit(tx, {
      tenantId,
      actorId: userId,
      action: "tenant.created_preview",
      objectType: "tenant",
      objectId: tenantId,
      payload: { workspaceType: "PUBLIC_CUSTOMER", preview: true },
    });
    // Point the user's current sessions (which have no workspace yet) at the new one.
    await tx
      .update(sessions)
      .set({ activeTenantId: tenantId })
      .where(and(eq(sessions.userId, userId), isNull(sessions.activeTenantId)));
  });
  return tenantId;
}
