import { createHash } from "node:crypto";

// Mirrors audit_ledger_canonical() and audit_ledger_chain() in
// db/migrations/0007_audit_ledger.sql.
export const GENESIS_HASH = "0".repeat(64);

export interface LedgerRow {
  seq: string;
  tsText: string; // to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  actorId: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  payloadText: string; // payload::text
  payloadSha256: string;
  prevHash: string;
  entryHash: string;
}

export type ChainResult = { ok: true; length: number } | { ok: false; seq: string; reason: string };

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function entryHash(
  prevHash: string,
  row: Omit<LedgerRow, "prevHash" | "entryHash" | "payloadText">,
): string {
  const canonical = [
    row.seq,
    row.tsText,
    row.actorId ?? "",
    row.action,
    row.objectType,
    row.objectId ?? "",
    row.payloadSha256,
  ].join("|");
  return sha256(`${prevHash}|${canonical}`);
}

// Rows must be one tenant's chain ordered by seq.
export function verifyChain(rows: readonly LedgerRow[]): ChainResult {
  let prev = GENESIS_HASH;
  let expectedSeq = 1n;
  for (const row of rows) {
    if (BigInt(row.seq) !== expectedSeq) return { ok: false, seq: row.seq, reason: "sequence gap" };
    if (sha256(row.payloadText) !== row.payloadSha256) {
      return { ok: false, seq: row.seq, reason: "payload hash mismatch" };
    }
    if (row.prevHash !== prev) return { ok: false, seq: row.seq, reason: "broken link" };
    if (entryHash(prev, row) !== row.entryHash) {
      return { ok: false, seq: row.seq, reason: "entry hash mismatch" };
    }
    prev = row.entryHash;
    expectedSeq += 1n;
  }
  return { ok: true, length: rows.length };
}
