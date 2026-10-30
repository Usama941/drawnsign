import {
  boolean,
  doublePrecision,
  foreignKey,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { documents, documentVersions } from "./documents";
import { users } from "./tenancy";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const envelopeStatus = pgEnum("envelope_status", [
  "DRAFT",
  "SENT",
  "COMPLETED",
  "DECLINED",
  "VOIDED",
  "EXPIRED",
]);
export const orderMode = pgEnum("order_mode", ["SEQUENTIAL", "PARALLEL"]);
export const recipientStatus = pgEnum("recipient_status", [
  "PENDING",
  "NOTIFIED",
  "SIGNED",
  "DECLINED",
]);
export const fieldType = pgEnum("field_type", [
  "SIGNATURE",
  "INITIALS",
  "DATE",
  "TEXT",
  "CHECKBOX",
  "DROPDOWN",
]);
export const signatureEventType = pgEnum("signature_event_type", [
  "CONSENTED",
  "OTP_VERIFIED",
  "SIGNED",
  "DECLINED",
]);

// An envelope binds its recipients to exactly one document version and that version's hash.
// The binding is frozen once the envelope is sent (0011_signing_guards.sql).
export const envelopes = pgTable(
  "envelopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    documentId: uuid("document_id").notNull(),
    documentVersionId: uuid("document_version_id").notNull(),
    versionSha256: text("version_sha256").notNull(),
    orderMode: orderMode("order_mode").notNull(),
    status: envelopeStatus("status").notNull().default("DRAFT"),
    expiresAt: ts("expires_at").notNull(),
    voidReason: text("void_reason"),
    signedVersionId: uuid("signed_version_id"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    sentAt: ts("sent_at"),
    completedAt: ts("completed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("envelopes_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "envelopes_document_fk",
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }),
    // Replaced in SQL by (tenant_id, document_id, document_version_id) so the version must
    // belong to this document; likewise signed_version_id.
    foreignKey({
      name: "envelopes_version_fk",
      columns: [t.tenantId, t.documentVersionId],
      foreignColumns: [documentVersions.tenantId, documentVersions.id],
    }),
  ],
);

export const recipients = pgTable(
  "recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    envelopeId: uuid("envelope_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    routingOrder: integer("routing_order").notNull(),
    status: recipientStatus("status").notNull().default("PENDING"),
    declineReason: text("decline_reason"),
    notifiedAt: ts("notified_at"),
    completedAt: ts("completed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("recipients_tenant_id_id_key").on(t.tenantId, t.id),
    unique("recipients_tenant_envelope_id_key").on(t.tenantId, t.envelopeId, t.id),
    foreignKey({
      name: "recipients_envelope_fk",
      columns: [t.tenantId, t.envelopeId],
      foreignColumns: [envelopes.tenantId, envelopes.id],
    }),
  ],
);

// Positions are fractions of the page (0..1, origin top-left), so they survive any render size.
export const fields = pgTable(
  "fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    envelopeId: uuid("envelope_id").notNull(),
    recipientId: uuid("recipient_id").notNull(),
    type: fieldType("type").notNull(),
    page: integer("page").notNull(),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    width: doublePrecision("width").notNull(),
    height: doublePrecision("height").notNull(),
    required: boolean("required").notNull().default(true),
    options: text("options").array(),
    value: text("value"),
    filledAt: ts("filled_at"),
  },
  (t) => [
    unique("fields_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "fields_recipient_fk",
      columns: [t.tenantId, t.envelopeId, t.recipientId],
      foreignColumns: [recipients.tenantId, recipients.envelopeId, recipients.id],
    }),
  ],
);

// Insert-only evidence (CLAUDE.md rule 6).
export const signatureEvents = pgTable(
  "signature_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    envelopeId: uuid("envelope_id").notNull(),
    recipientId: uuid("recipient_id").notNull(),
    type: signatureEventType("type").notNull(),
    versionSha256: text("version_sha256").notNull(),
    ts: ts("ts").notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    authMethod: text("auth_method"),
    details: jsonb("details").notNull().default({}),
  },
  (t) => [
    foreignKey({
      name: "signature_events_recipient_fk",
      columns: [t.tenantId, t.envelopeId, t.recipientId],
      foreignColumns: [recipients.tenantId, recipients.envelopeId, recipients.id],
    }),
  ],
);

// Signing link credential (CLAUDE.md rule 2): hash only, one recipient, one version, expiring.
export const signingTokens = pgTable(
  "signing_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    envelopeId: uuid("envelope_id").notNull(),
    recipientId: uuid("recipient_id").notNull(),
    documentVersionId: uuid("document_version_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "signing_tokens_recipient_fk",
      columns: [t.tenantId, t.envelopeId, t.recipientId],
      foreignColumns: [recipients.tenantId, recipients.envelopeId, recipients.id],
    }),
    foreignKey({
      name: "signing_tokens_version_fk",
      columns: [t.tenantId, t.documentVersionId],
      foreignColumns: [documentVersions.tenantId, documentVersions.id],
    }),
  ],
);

// Email one-time codes for signers. Code and session token are stored only as hashes.
export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    envelopeId: uuid("envelope_id").notNull(),
    recipientId: uuid("recipient_id").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: ts("expires_at").notNull(),
    verifiedAt: ts("verified_at"),
    sessionHash: text("session_hash").unique(),
    sessionExpiresAt: ts("session_expires_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "otp_challenges_recipient_fk",
      columns: [t.tenantId, t.envelopeId, t.recipientId],
      foreignColumns: [recipients.tenantId, recipients.envelopeId, recipients.id],
    }),
  ],
);

// Global fixed-window rate limiter. Keys are hashes; no tenant data.
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: ts("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
