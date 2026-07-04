import type { AppConfig } from "@app/config";
import { authAccounts, authSessions, authUsers, authVerifications, type Database } from "@repo/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { testUtils } from "better-auth/plugins";

// 本番 auth 設定(createAuth)に testUtils を混ぜず、ローカル開発専用の別インスタンスとして持つ
// (better-auth 公式推奨: ctx.test は任意ユーザーのセッションを即座に発行できる特権ヘルパーのため)。
// secret/db は本番用インスタンスと共有するので、ここで発行した session cookie は
// 通常の auth インスタンスの検証をそのまま通る。
export function createDevAuth(config: AppConfig["auth"], db: Database) {
  return betterAuth({
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: config.trustedOrigins,
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
    plugins: [testUtils()],
  });
}

export type DevAuth = ReturnType<typeof createDevAuth>;
