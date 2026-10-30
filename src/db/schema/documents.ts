import {
  bigint,
  boolean,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants, users } from "./tenancy";

const ts = (name: string) => timestamp(name, { withTimezone: true });

// PRD section 8. Allowed transitions are enforced by a trigger (0009_documents_guards.sql).
export const documentStatus = pgEnum("document_status", [
  "DRAFT",
  "SENT",
  "PARTIALLY_SIGNED",
  "COMPLETED",
  "DECLINED",
  "VOIDED",
  "EXPIRED",
  "AMENDED",
  "ARCHIVED",
  "DELETED",
]);

export const versionKind = pgEnum("version_kind", [
  "DRAFT",
  "SENT",
  "SIGNED",
  "AMENDED",
  "CORRECTION",
]);

export const storageClass = pgEnum("storage_class", ["DRAFTS", "EVIDENCE"]);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    // DOC- + 10 Crockford base32 characters; globally unique so the verify page can find it.
    publicId: text("public_id").notNull().unique(),
    title: text("title").notNull(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    status: documentStatus("status").notNull().default("DRAFT"),
    currentVersionId: uuid("current_version_id"),
    legalHold: boolean("legal_hold").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("documents_tenant_id_id_key").on(t.tenantId, t.id)],
);

// Insert-only (CLAUDE.md rule 6). version_no is assigned by a trigger.
export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    documentId: uuid("document_id").notNull(),
    versionNo: integer("version_no").notNull(),
    parentVersionId: uuid("parent_version_id"),
    kind: versionKind("kind").notNull(),
    storageClass: storageClass("storage_class").notNull(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    pageCount: integer("page_count").notNull(),
    createdBy: uuid("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("document_versions_tenant_id_id_key").on(t.tenantId, t.id),
    unique("document_versions_document_id_version_no_key").on(t.documentId, t.versionNo),
    foreignKey({
      name: "document_versions_document_fk",
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }),
    foreignKey({
      name: "document_versions_parent_fk",
      columns: [t.tenantId, t.parentVersionId],
      foreignColumns: [t.tenantId, t.id],
    }),
  ],
);

// A browser upload waiting to be sanitised into a DRAFT version. The raw bytes live under the
// tenant's drafts prefix and are deleted once processed.
export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    documentId: uuid("document_id").notNull(),
    storageKey: text("storage_key").notNull(),
    status: text("status", { enum: ["PENDING", "UPLOADED", "ACCEPTED", "REJECTED"] })
      .notNull()
      .default("PENDING"),
    rejectReason: text("reject_reason"),
    versionId: uuid("version_id"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("uploads_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "uploads_document_fk",
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }),
    foreignKey({
      name: "uploads_version_fk",
      columns: [t.tenantId, t.versionId],
      foreignColumns: [documentVersions.tenantId, documentVersions.id],
    }),
  ],
);

// The QR/URL token for one document version (CLAUDE.md rule 2). Stored only as a hash and
// expires at the document's retention end.
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    documentId: uuid("document_id").notNull(),
    versionId: uuid("version_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("verification_tokens_version_id_key").on(t.versionId),
    foreignKey({
      name: "verification_tokens_document_fk",
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }),
    // Replaced in 0009_documents_guards.sql by (tenant_id, document_id, version_id), so the
    // version must also belong to this document.
    foreignKey({
      name: "verification_tokens_version_fk",
      columns: [t.tenantId, t.versionId],
      foreignColumns: [documentVersions.tenantId, documentVersions.id],
    }),
  ],
);
