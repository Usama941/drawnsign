import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EVIDENCE_TABLES } from "@/db/evidence";
import { connect, existingTables } from "./helpers";

describe("database roles", () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await connect("admin");
  });
  afterAll(async () => {
    await admin.end();
  });

  it("app_role cannot log in, is not superuser and cannot bypass RLS", async () => {
    const { rows } = await admin.query(
      "SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_role'",
    );
    expect(rows).toEqual([{ rolcanlogin: false, rolsuper: false, rolbypassrls: false }]);
  });

  it("app_role owns no tables", async () => {
    const { rows } = await admin.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'app_role'",
    );
    expect(rows).toEqual([]);
  });

  it("new tables default to SELECT and INSERT only for app_role", async () => {
    await admin.query("CREATE TABLE IF NOT EXISTS zz_default_priv_probe (id int)");
    try {
      const { rows } = await admin.query(
        `SELECT privilege_type FROM information_schema.role_table_grants
         WHERE grantee = 'app_role' AND table_name = 'zz_default_priv_probe'
         ORDER BY privilege_type`,
      );
      expect(rows.map((r) => r.privilege_type)).toEqual(["INSERT", "SELECT"]);
    } finally {
      await admin.query("DROP TABLE zz_default_priv_probe");
    }
  });

  it("app_role has no UPDATE, DELETE or TRUNCATE on any evidence table", async () => {
    const tables = await existingTables(admin, EVIDENCE_TABLES);
    for (const table of tables) {
      for (const priv of ["UPDATE", "DELETE", "TRUNCATE"]) {
        const { rows } = await admin.query(
          "SELECT has_table_privilege('app_role', $1, $2) AS allowed",
          [`public.${table}`, priv],
        );
        expect({ table, priv, allowed: rows[0].allowed }).toEqual({ table, priv, allowed: false });
      }
    }
  });
});
