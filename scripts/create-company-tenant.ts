import { randomUUID } from "node:crypto";
import { Client } from "pg";

// The only way to create a COMPANY_MANAGED tenant (PRD section 7). Run by a platform
// super-admin against the migrator connection:
//   DATABASE_URL_MIGRATOR=... pnpm tsx scripts/create-company-tenant.ts "<name>" <admin-email>
// The admin user must already have an account.
async function main(): Promise<void> {
  const [name, adminEmail] = process.argv.slice(2);
  const url = process.env.DATABASE_URL_MIGRATOR;
  if (!name || !adminEmail) throw new Error("usage: create-company-tenant <name> <admin-email>");
  if (!url) throw new Error("DATABASE_URL_MIGRATOR is not set");

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [
      adminEmail.toLowerCase(),
    ]);
    const userId = user.rows[0]?.id;
    if (!userId) throw new Error(`no user with email ${adminEmail}`);

    const tenantId = randomUUID();
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query(
      "INSERT INTO tenants (id, name, workspace_type) VALUES ($1, $2, 'COMPANY_MANAGED')",
      [tenantId, name],
    );
    await client.query(
      `INSERT INTO memberships (tenant_id, workspace_type, user_id, role)
       VALUES ($1, 'COMPANY_MANAGED', $2, 'COMPANY_ADMIN')`,
      [tenantId, userId],
    );
    await client.query(
      `INSERT INTO audit_ledger (tenant_id, actor_id, action, object_type, object_id, payload,
                                 seq, payload_sha256, prev_hash, entry_hash)
       VALUES ($1, NULL, 'tenant.created', 'tenant', $1, $2, 0, '', '', '')`,
      [tenantId, JSON.stringify({ workspaceType: "COMPANY_MANAGED", firstAdmin: userId })],
    );
    await client.query("COMMIT");
    console.log(`created COMPANY_MANAGED tenant ${tenantId}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
