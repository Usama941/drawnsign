import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "./client";
import type { WorkspaceType } from "./schema";

export interface SigningTokenMatch {
  tenantId: string;
  workspaceType: WorkspaceType;
  envelopeId: string;
  recipientId: string;
}

// The only cross-tenant read for signers (CLAUDE.md rule 2): one narrow SECURITY DEFINER
// function returning the tenant and the single recipient for a live token hash.
export async function lookupSigningToken(tokenHash: string): Promise<SigningTokenMatch | null> {
  const { rows } = await getDb().execute<{
    tenant_id: string;
    workspace_type: WorkspaceType;
    envelope_id: string;
    recipient_id: string;
  }>(sql`SELECT * FROM signing_lookup(${tokenHash})`);
  const row = rows[0];
  return row
    ? {
        tenantId: row.tenant_id,
        workspaceType: row.workspace_type,
        envelopeId: row.envelope_id,
        recipientId: row.recipient_id,
      }
    : null;
}

// Fixed-window limiter on a global table. Keys are hashed before storage.
export async function rateLimitHit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  const hashed = createHash("sha256").update(key).digest("hex");
  const { rows } = await getDb().execute<{ ok: boolean }>(
    sql`SELECT rate_limit_hit(${hashed}, ${max}, ${windowSeconds}) AS ok`,
  );
  return rows[0]?.ok === true;
}

export async function dueEnvelopeExpiries(limit: number) {
  const { rows } = await getDb().execute<{
    tenant_id: string;
    workspace_type: WorkspaceType;
    envelope_id: string;
  }>(sql`SELECT * FROM due_envelope_expiries(${limit})`);
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    workspaceType: r.workspace_type,
    envelopeId: r.envelope_id,
  }));
}
