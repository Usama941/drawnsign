import {
  bigint,
  bigserial,
  date,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";

// Hash-chained, insert-only audit ledger (CLAUDE.md rules 6 and 7). seq, ts, payload_sha256,
// prev_hash and entry_hash are always computed by the database trigger in
// db/migrations/0007_audit_ledger.sql; any value the app sends for them is overwritten.
export const auditLedger = pgTable(
  "audit_ledger",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    seq: bigint("seq", { mode: "bigint" }).notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    objectType: text("object_type").notNull(),
    objectId: text("object_id"),
    payload: jsonb("payload").notNull().default({}),
    payloadSha256: text("payload_sha256").notNull(),
    prevHash: text("prev_hash").notNull(),
    entryHash: text("entry_hash").notNull(),
  },
  (t) => [unique("audit_ledger_tenant_id_seq_key").on(t.tenantId, t.seq)],
);

// Daily chain head per tenant. Copying anchors to a separate locked store is a pre-go-live
// requirement (PRD sections 17-18).
export const ledgerAnchors = pgTable(
  "ledger_anchors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    anchorDate: date("anchor_date").notNull(),
    lastSeq: bigint("last_seq", { mode: "bigint" }).notNull(),
    rootHash: text("root_hash").notNull(),
    externalRef: text("external_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ledger_anchors_tenant_id_anchor_date_key").on(t.tenantId, t.anchorDate),
    foreignKey({
      name: "ledger_anchors_ledger_fk",
      columns: [t.tenantId, t.lastSeq],
      foreignColumns: [auditLedger.tenantId, auditLedger.seq],
    }),
  ],
);
