import type { AppConfig } from "@app/config";
import { authAccounts, authSessions, authUsers, authVerifications, type Database } from "@repo/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export function createAuth(config: AppConfig["auth"], nodeEnv: AppConfig["nodeEnv"], db: Database) {
  const isProduction = nodeEnv === "production";
  return betterAuth({
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: config.trustedOrigins,
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["CF-Connecting-IP"],
      },
      cookies: {
        session_token: {
          attributes: {
            httpOnly: true,
            secure: isProduction,
            sameSite: "lax",
          },
        },
      },
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
