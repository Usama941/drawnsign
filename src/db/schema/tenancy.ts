import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const workspaceType = pgEnum("workspace_type", ["COMPANY_MANAGED", "PUBLIC_CUSTOMER"]);
export type WorkspaceType = (typeof workspaceType.enumValues)[number];

// Global identity (no tenant_id). Columns follow Better Auth's user model.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// workspace_type is set once on insert; a trigger rejects any change (CLAUDE.md rule 1).
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    workspaceType: workspaceType("workspace_type").notNull(),
    region: text("region").notNull().default("uk"),
    retentionYears: integer("retention_years").notNull().default(7),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("tenants_id_workspace_type_key").on(t.id, t.workspaceType)],
);

// Role catalogue per workspace type. Role names never overlap between types, and the
// composite foreign keys below stop a membership or invitation using the other type's roles.
export const workspaceRoles = pgTable(
  "workspace_roles",
  {
    workspaceType: workspaceType("workspace_type").notNull(),
    role: text("role").notNull().unique(),
  },
  (t) => [primaryKey({ columns: [t.workspaceType, t.role] })],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    workspaceType: workspaceType("workspace_type").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    teamScope: text("team_scope")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text("status", { enum: ["ACTIVE", "SUSPENDED"] })
      .notNull()
      .default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("memberships_tenant_id_id_key").on(t.tenantId, t.id),
    unique("memberships_tenant_id_user_id_key").on(t.tenantId, t.userId),
    foreignKey({
      name: "memberships_tenant_fk",
      columns: [t.tenantId, t.workspaceType],
      foreignColumns: [tenants.id, tenants.workspaceType],
    }),
    foreignKey({
      name: "memberships_role_fk",
      columns: [t.workspaceType, t.role],
      foreignColumns: [workspaceRoles.workspaceType, workspaceRoles.role],
    }),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    workspaceType: workspaceType("workspace_type").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull(),
    teamScope: text("team_scope")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // sha256 of the single-use token; the token itself is never stored.
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("invitations_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "invitations_tenant_fk",
      columns: [t.tenantId, t.workspaceType],
      foreignColumns: [tenants.id, tenants.workspaceType],
    }),
    foreignKey({
      name: "invitations_role_fk",
      columns: [t.workspaceType, t.role],
      foreignColumns: [workspaceRoles.workspaceType, workspaceRoles.role],
    }),
  ],
);
