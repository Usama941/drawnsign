import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLES } from "@/auth/permissions";
import { connect } from "./helpers";

describe("role catalogue", () => {
  let admin: Client;
  beforeAll(async () => {
    admin = await connect("admin");
  });
  afterAll(async () => {
    await admin.end();
  });

  it("database workspace_roles matches the code catalogues exactly", async () => {
    const { rows } = await admin.query<{ workspace_type: string; role: string }>(
      "SELECT workspace_type, role FROM workspace_roles ORDER BY workspace_type, role",
    );
    const fromDb = rows.map((r) => `${r.workspace_type}:${r.role}`);
    const fromCode = Object.entries(ROLES)
      .flatMap(([type, roles]) => roles.map((r) => `${type}:${r}`))
      .sort();
    expect(fromDb).toEqual(fromCode);
  });
});
