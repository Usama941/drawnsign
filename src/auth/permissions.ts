import type { WorkspaceType } from "@/db/schema";
import type { AppSession } from "./session";

// Two separate permission catalogues, one per workspace type (PRD section 4, CLAUDE.md rule 1).
// Permission and role names never overlap between catalogues. Roles must match the
// workspace_roles rows seeded in db/migrations/0002_tenancy_guards.sql.
//
// Grant scopes: "all" = whole tenant, "team" = own teams, "own" = own records only,
// "shared" = records explicitly shared with the user, "with_approval" = allowed, but the
// action needs a second approver.
export type Scope = "all" | "team" | "own" | "shared" | "with_approval";

export const COMPANY_ROLES = [
  "COMPANY_ADMIN",
  "COMPANY_MANAGER",
  "COMPANY_EMPLOYEE",
  "COMPANY_AUDITOR",
] as const;
export const CUSTOMER_ROLES = [
  "CUSTOMER_OWNER",
  "CUSTOMER_ADMIN",
  "CUSTOMER_SENDER",
  "CUSTOMER_VIEWER",
] as const;

type CompanyRole = (typeof COMPANY_ROLES)[number];
type CustomerRole = (typeof CUSTOMER_ROLES)[number];

const COMPANY_CATALOGUE = {
  "company.managers.manage": { COMPANY_ADMIN: "all" },
  "company.agreements.publish": { COMPANY_ADMIN: "all" },
  "company.amendment_policy.define": { COMPANY_ADMIN: "all" },
  "company.employees.invite": { COMPANY_ADMIN: "all", COMPANY_MANAGER: "team" },
  "company.documents.send": { COMPANY_ADMIN: "all", COMPANY_MANAGER: "team" },
  "company.documents.view": {
    COMPANY_ADMIN: "all",
    COMPANY_MANAGER: "team",
    COMPANY_EMPLOYEE: "own",
    COMPANY_AUDITOR: "all",
  },
  "company.amendments.propose_clerical": { COMPANY_ADMIN: "all", COMPANY_MANAGER: "team" },
  "company.amendments.propose_administrative": { COMPANY_ADMIN: "all", COMPANY_MANAGER: "team" },
  "company.amendments.propose_material": { COMPANY_ADMIN: "all", COMPANY_MANAGER: "with_approval" },
  // Approver must not be the proposer; enforced in the amendment service and the database.
  "company.amendments.approve": { COMPANY_ADMIN: "all" },
  "company.amendments.respond": { COMPANY_EMPLOYEE: "own" },
  "company.documents.sign": { COMPANY_EMPLOYEE: "own" },
  "company.corrections.record": { COMPANY_ADMIN: "all", COMPANY_MANAGER: "own" },
  "company.reports.view": {
    COMPANY_ADMIN: "all",
    COMPANY_MANAGER: "team",
    COMPANY_EMPLOYEE: "own",
    COMPANY_AUDITOR: "all",
  },
  "company.reports.export": {
    COMPANY_ADMIN: "all",
    COMPANY_MANAGER: "team",
    COMPANY_EMPLOYEE: "own",
    COMPANY_AUDITOR: "all",
  },
  "company.legal_holds.place": { COMPANY_ADMIN: "all" },
} as const satisfies Record<string, Partial<Record<CompanyRole, Scope>>>;

const CUSTOMER_CATALOGUE = {
  "customer.billing.manage": { CUSTOMER_OWNER: "all" },
  "customer.users.manage": { CUSTOMER_OWNER: "all", CUSTOMER_ADMIN: "all" },
  "customer.settings.manage": { CUSTOMER_OWNER: "all", CUSTOMER_ADMIN: "all" },
  "customer.documents.send": {
    CUSTOMER_OWNER: "all",
    CUSTOMER_ADMIN: "all",
    CUSTOMER_SENDER: "all",
  },
  "customer.documents.view": {
    CUSTOMER_OWNER: "all",
    CUSTOMER_ADMIN: "all",
    CUSTOMER_SENDER: "own",
    CUSTOMER_VIEWER: "shared",
  },
  "customer.envelopes.void": {
    CUSTOMER_OWNER: "all",
    CUSTOMER_ADMIN: "all",
    CUSTOMER_SENDER: "own",
  },
  "customer.documents.download": {
    CUSTOMER_OWNER: "all",
    CUSTOMER_ADMIN: "all",
    CUSTOMER_SENDER: "own",
    CUSTOMER_VIEWER: "shared",
  },
  "customer.documents.delete": { CUSTOMER_OWNER: "all", CUSTOMER_ADMIN: "all" },
} as const satisfies Record<string, Partial<Record<CustomerRole, Scope>>>;

export type CompanyPermission = keyof typeof COMPANY_CATALOGUE;
export type CustomerPermission = keyof typeof CUSTOMER_CATALOGUE;
export type Permission = CompanyPermission | CustomerPermission;

const CATALOGUES: Record<WorkspaceType, Record<string, Partial<Record<string, Scope>>>> = {
  COMPANY_MANAGED: COMPANY_CATALOGUE,
  PUBLIC_CUSTOMER: CUSTOMER_CATALOGUE,
};

export const ROLES: Record<WorkspaceType, readonly string[]> = {
  COMPANY_MANAGED: COMPANY_ROLES,
  PUBLIC_CUSTOMER: CUSTOMER_ROLES,
};

export function permissionsFor(workspaceType: WorkspaceType): string[] {
  return Object.keys(CATALOGUES[workspaceType]);
}

// The scope the caller holds for a permission, or null. Unknown permissions, permissions from
// the other workspace type's catalogue, missing tenants and unmet MFA all deny.
export function scopeOf(session: AppSession | null, permission: string): Scope | null {
  const tenant = session?.tenant;
  if (!tenant || !tenant.mfaSatisfied) return null;
  const catalogue = CATALOGUES[tenant.workspaceType];
  if (!Object.hasOwn(catalogue, permission)) return null;
  const grants = catalogue[permission]!;
  return Object.hasOwn(grants, tenant.role) ? grants[tenant.role]! : null;
}

export function can(session: AppSession | null, permission: Permission): boolean {
  return scopeOf(session, permission) !== null;
}
