import { defineConfig } from "drizzle-kit";

// `pnpm db:generate` is offline: it diffs src/db/schema against db/migrations/meta.
// RLS policies, triggers and grants are hand-written SQL migrations (drizzle-kit generate --custom).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL_MIGRATOR ?? "" },
});
