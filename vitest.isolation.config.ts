import { defineConfig } from "vitest/config";

// Cross-tenant and immutability suite. Runs against a real Postgres (DATABASE_URL_ADMIN).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/isolation/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/isolation/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
