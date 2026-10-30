import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Runs as the schema owner (DATABASE_URL_MIGRATOR), never as the app role.
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "db/migrations" });
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  const url = process.env.DATABASE_URL_MIGRATOR;
  if (!url) throw new Error("DATABASE_URL_MIGRATOR is not set");
  runMigrations(url).then(
    () => console.log("migrations applied"),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}
