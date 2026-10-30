import { defineConfig } from "vitest/config";

// Browser smoke tests against a running `next start` (run `pnpm build` first).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/isolation/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
