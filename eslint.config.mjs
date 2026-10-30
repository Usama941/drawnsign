import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "db/migrations/meta/**"],
  },
  {
    // Raw DB access only inside src/db; everything else uses withTenant() (CLAUDE.md rule 3).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/db/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/db/client", "**/db/client", "pg", "drizzle-orm/node-postgres"],
              message:
                "Use withTenant() from @/db/tenant; raw database access is limited to src/db.",
            },
          ],
        },
      ],
    },
  },
];

export default config;
