import { sql } from "drizzle-orm";
import type { LedgerRow } from "@/audit/chain";
import { getDb } from "./client";
import { auditLedger } from "./schema";
import type { Tx } from "./tenant";

export interface AuditEntry {
  tenantId: string;
  actorId: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  payload?: Record<string, unknown>;
}

// Appends one entry inside the caller's transaction. Hash fields are filled by the trigger.
export async function appendAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLedger).values({
    tenantId: entry.tenantId,
    actorId: entry.actorId,
    action: entry.action,
    objectType: entry.objectType,
    objectId: entry.objectId ?? null,
    payload: entry.payload ?? {},
    payloadSha256: "",
    prevHash: "",
    entryHash: "",
    seq: 0n,
  });
}

// The session tenant's chain, in the exact text forms the verifier hashes.
export async function loadChain(tx: Tx): Promise<LedgerRow[]> {
  const { rows } = await tx.execute<LedgerRow & Record<string, unknown>>(sql`
    SELECT seq::text AS "seq",
           to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "tsText",
           actor_id::text AS "actorId", action, object_type AS "objectType",
           object_id AS "objectId", payload::text AS "payloadText",
           payload_sha256 AS "payloadSha256", prev_hash AS "prevHash", entry_hash AS "entryHash"
    FROM audit_ledger WHERE tenant_id = current_tenant_id() ORDER BY audit_ledger.seq`);
  return rows;
}

// Cross-tenant daily anchor. Runs only through the anchor_ledgers() SECURITY DEFINER function.
export async function anchorLedgers(date: string): Promise<number> {
  const { rows } = await getDb().execute<{ n: number }>(
    sql`SELECT anchor_ledgers(${date}::date) AS n`,
  );
  return rows[0]?.n ?? 0;
}
