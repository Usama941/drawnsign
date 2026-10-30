import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { authDatabaseAdapter } from "@/db/auth-adapter";
import { listOwnMemberships } from "@/db/memberships";
import { getMailer } from "@/lib/mail";
import { sessionCreatedWithMfa } from "./mfa";

function createAuth() {
  const baseURL = process.env.BETTER_AUTH_URL;
  const appName = "drawnsign";
  return betterAuth({
    appName,
    baseURL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: authDatabaseAdapter(),
    advanced: { database: { generateId: "uuid" } },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      async sendVerificationEmail({ user, url }) {
        await getMailer().send({
          to: user.email,
          subject: "Verify your email address",
          text: `Confirm your email address to finish creating your account:\n\n${url}\n`,
        });
      },
    },
    session: {
      additionalFields: {
        // Never accepted from request input; set only by the hook below.
        activeTenantId: { type: "string", required: false, input: false },
        mfaVerified: { type: "boolean", required: false, input: false, defaultValue: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          async before(session, ctx) {
            // A user with exactly one membership lands in that tenant. Users with several
            // memberships choose later through a membership-based switch (never a raw tenant id).
            const own = await listOwnMemberships(session.userId);
            return {
              data: {
                ...session,
                activeTenantId: own.length === 1 ? own[0]!.tenantId : null,
                mfaVerified: sessionCreatedWithMfa(ctx?.path),
              },
            };
          },
        },
      },
    },
    plugins: [
      twoFactor({ issuer: appName }),
      passkey({
        rpName: appName,
        rpID: baseURL ? new URL(baseURL).hostname : "localhost",
        origin: baseURL ?? "http://localhost:3000",
      }),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let auth: Auth | undefined;

export function getAuth(): Auth {
  auth ??= createAuth();
  return auth;
}
