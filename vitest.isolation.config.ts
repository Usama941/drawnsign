import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Cross-tenant and immutability suite. Runs against a real Postgres (DATABASE_URL_ADMIN).
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["tests/isolation/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
