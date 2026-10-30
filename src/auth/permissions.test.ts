import { describe, expect, it } from "vitest";
import type { WorkspaceType } from "@/db/schema";
import {
  can,
  COMPANY_ROLES,
  CUSTOMER_ROLES,
  permissionsFor,
  scopeOf,
  type Permission,
} from "./permissions";
import type { AppSession } from "./session";

function session(workspaceType: WorkspaceType, role: string, mfaSatisfied = true): AppSession {
  return {
    userId: "00000000-0000-0000-0000-000000000001",
    email: "u@example.test",
    tenant: {
      tenantId: "00000000-0000-0000-0000-0000000000aa",
      workspaceType,
      role,
      teamScope: [],
      mfaSatisfied,
    },
  };
}

describe("permission catalogues", () => {
  it("share no permission names", () => {
    const company = permissionsFor("COMPANY_MANAGED");
    const customer = permissionsFor("PUBLIC_CUSTOMER");
    expect(company.filter((p) => customer.includes(p))).toEqual([]);
    expect(company.every((p) => p.startsWith("company."))).toBe(true);
    expect(customer.every((p) => p.startsWith("customer."))).toBe(true);
  });

  it("share no role names", () => {
    expect(COMPANY_ROLES.filter((r) => (CUSTOMER_ROLES as readonly string[]).includes(r))).toEqual(
      [],
    );
  });

  it("deny unknown permissions", () => {
    expect(scopeOf(session("COMPANY_MANAGED", "COMPANY_ADMIN"), "company.everything")).toBeNull();
    expect(scopeOf(session("COMPANY_MANAGED", "COMPANY_ADMIN"), "toString")).toBeNull();
    expect(scopeOf(session("COMPANY_MANAGED", "COMPANY_ADMIN"), "__proto__")).toBeNull();
  });

  it("deny every company permission to every public role, and vice versa", () => {
    for (const role of CUSTOMER_ROLES) {
      for (const p of permissionsFor("COMPANY_MANAGED")) {
        expect(can(session("PUBLIC_CUSTOMER", role), p as Permission)).toBe(false);
      }
    }
    for (const role of COMPANY_ROLES) {
      for (const p of permissionsFor("PUBLIC_CUSTOMER")) {
        expect(can(session("COMPANY_MANAGED", role), p as Permission)).toBe(false);
      }
    }
  });

  it("deny a role name from the other catalogue even if a session somehow carried it", () => {
    expect(can(session("PUBLIC_CUSTOMER", "COMPANY_ADMIN"), "company.managers.manage")).toBe(false);
    expect(can(session("COMPANY_MANAGED", "CUSTOMER_OWNER"), "customer.billing.manage")).toBe(
      false,
    );
  });

  it("deny everything to company admins and managers without MFA", () => {
    for (const role of ["COMPANY_ADMIN", "COMPANY_MANAGER"]) {
      for (const p of permissionsFor("COMPANY_MANAGED")) {
        expect(can(session("COMPANY_MANAGED", role, false), p as Permission)).toBe(false);
      }
    }
  });

  it("deny when there is no session or no tenant", () => {
    expect(can(null, "customer.documents.send")).toBe(false);
    expect(can({ userId: "u", email: "e", tenant: null }, "customer.documents.send")).toBe(false);
  });

  it("matches PRD section 4 for key cells", () => {
    expect(
      scopeOf(session("COMPANY_MANAGED", "COMPANY_MANAGER"), "company.amendments.propose_material"),
    ).toBe("with_approval");
    expect(can(session("COMPANY_MANAGED", "COMPANY_MANAGER"), "company.amendments.approve")).toBe(
      false,
    );
    expect(can(session("COMPANY_MANAGED", "COMPANY_AUDITOR"), "company.documents.send")).toBe(
      false,
    );
    expect(scopeOf(session("COMPANY_MANAGED", "COMPANY_EMPLOYEE"), "company.documents.view")).toBe(
      "own",
    );
    expect(can(session("PUBLIC_CUSTOMER", "CUSTOMER_ADMIN"), "customer.billing.manage")).toBe(
      false,
    );
    expect(can(session("PUBLIC_CUSTOMER", "CUSTOMER_OWNER"), "customer.billing.manage")).toBe(true);
    expect(can(session("PUBLIC_CUSTOMER", "CUSTOMER_VIEWER"), "customer.documents.send")).toBe(
      false,
    );
  });
});
