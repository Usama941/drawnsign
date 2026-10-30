import { sql } from "drizzle-orm";
import { getDb, type Database } from "./client";
import type { WorkspaceType } from "./schema";

// The only way application code reaches tenant data. The context must come from the
// authenticated session or API key, never from the URL, query string or body (CLAUDE.md rule 2).
export interface TenantContext {
  tenantId: string;
  workspaceType: WorkspaceType;
  // Null for callers without an account: external signers and system jobs.
  userId: string | null;
}

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(ctx.tenantId) || (ctx.userId !== null && !UUID.test(ctx.userId))) {
    throw new Error("withTenant: invalid tenant context");
  }
  return getDb().transaction(async (tx) => {
    // is_local = true: the setting ends with this transaction and never leaks to the pool.
    await tx.execute(
      sql`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true),
                 set_config('app.user_id', ${ctx.userId ?? ""}, true)`,
    );
    return fn(tx);
  });
}
