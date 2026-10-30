import { and, eq } from "drizzle-orm";
import { memberships, tenants } from "@/db/schema";
import type { TenantContext, Tx } from "@/db/tenant";

// Background jobs receive their tenant context in the event payload. The payload is built
// server-side, but every job still re-checks it against the database inside withTenant()
// before doing anything, and refuses to run on any mismatch.
export class JobContextError extends Error {
  constructor(reason: string) {
    super(`job refused: ${reason}`);
  }
}

export async function verifyJobContext(tx: Tx, ctx: TenantContext): Promise<void> {
  const [tenant] = await tx
    .select({ workspaceType: tenants.workspaceType })
    .from(tenants)
    .where(eq(tenants.id, ctx.tenantId));
  if (!tenant || tenant.workspaceType !== ctx.workspaceType) {
    throw new JobContextError("tenant does not match");
  }
  if (ctx.userId !== null) {
    const [member] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, ctx.userId),
          eq(memberships.tenantId, ctx.tenantId),
          eq(memberships.status, "ACTIVE"),
        ),
      );
    if (!member) throw new JobContextError("user is not an active member of the tenant");
  }
}

// The row a job acts on must exist in the job's tenant (RLS hides other tenants' rows, so a
// missing row means the id belongs elsewhere or does not exist).
export function requireRow<T>(row: T | undefined, what: string): T {
  if (!row) throw new JobContextError(`${what} not found in tenant`);
  return row;
}
