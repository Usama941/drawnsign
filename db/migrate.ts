import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";

// Runs as the schema owner (DATABASE_URL_MIGRATOR), never as the app role.
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "db/migrations" });
  } finally {
    await pool.end();
  }
}

// Creates (or re-keys) the app's login role `app_user` as a member of app_role only
// (docs/runbooks/database-roles.md). The password comes from APP_DB_PASSWORD and is never logged.
export async function ensureAppUser(connectionString: string, password: string): Promise<void> {
  if (password.length < 24) throw new Error("APP_DB_PASSWORD must be at least 24 characters");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'app_user'");
    const verb = rows.length ? "ALTER" : "CREATE";
    const { rows: sqlRows } = await client.query<{ sql: string }>(
      `SELECT format('${verb} ROLE app_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L', $1::text) AS sql`,
      [password],
    );
    await client.query(sqlRows[0]!.sql);
    await client.query("GRANT app_role TO app_user");
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  // --if-configured: used by `pnpm build`, so a deployment with DATABASE_URL_MIGRATOR set
  // migrates itself and builds without it (CI, local) simply skip this step.
  const optional = process.argv.includes("--if-configured");
  const url = process.env.DATABASE_URL_MIGRATOR;
  const main = async () => {
    if (!url) {
      if (optional) return console.log("DATABASE_URL_MIGRATOR not set; skipping migrations");
      throw new Error("DATABASE_URL_MIGRATOR is not set");
    }
    await runMigrations(url);
    console.log("migrations applied");
    if (process.env.APP_DB_PASSWORD) {
      await ensureAppUser(url, process.env.APP_DB_PASSWORD);
      console.log("app_user login role is ready");
    }
  };
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
