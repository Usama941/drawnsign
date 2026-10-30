import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "./client";
import { accounts, passkeys, sessions, twoFactors, users, verifications } from "./schema";

// Better Auth only touches global identity tables, none of which hold tenant data.
export function authDatabaseAdapter() {
  return drizzleAdapter(getDb(), {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
      twoFactor: twoFactors,
      passkey: passkeys,
    },
  });
}
