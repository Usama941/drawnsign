import { randomBytes } from "node:crypto";
import { Client } from "pg";
import type { TestProject } from "vitest/node";
import { runMigrations } from "../../db/migrate";

declare module "vitest" {
  export interface ProvidedContext {
    adminUrl: string;
    appUrl: string;
  }
}

export const APP_LOGIN_ROLE = "app_test_login";

// Rebuilds the test database from migrations, then creates a login role that is a member of
// app_role only, with a password generated for this run.
export default async function setup(project: TestProject): Promise<void> {
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!adminUrl) throw new Error("DATABASE_URL_ADMIN is not set (see .env.example)");

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query("DROP SCHEMA IF EXISTS public CASCADE");
    await admin.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await admin.query("CREATE SCHEMA public");
  } finally {
    await admin.end();
  }

  await runMigrations(adminUrl);

  const password = randomBytes(24).toString("hex");
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_LOGIN_ROLE}') THEN
          CREATE ROLE ${APP_LOGIN_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END $$`);
    await client.query(`ALTER ROLE ${APP_LOGIN_ROLE} PASSWORD '${password}'`);
    await client.query(`GRANT app_role TO ${APP_LOGIN_ROLE}`);
  } finally {
    await client.end();
  }

  const appUrl = new URL(adminUrl);
  appUrl.username = APP_LOGIN_ROLE;
  appUrl.password = password;

  project.provide("adminUrl", adminUrl);
  project.provide("appUrl", appUrl.toString());
}
