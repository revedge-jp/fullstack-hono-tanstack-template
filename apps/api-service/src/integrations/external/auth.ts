import type { AppConfig } from "@app/config";
import { authAccounts, authSessions, authUsers, authVerifications, type Database } from "@repo/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

// Better Auth の内蔵ロガー(@better-auth/core の createLogger)は options.logger が未指定だと
// 自前の console.error/warn/log で出力する。それはこのアプリの pino を通らないため、
// (1) @repo/logging の redact が効かない、(2) 生の console.error はメッセージ全文がそのまま
// Cloudflare の `$metadata.error` に入る、という2点で問題になる。DB 障害時には SQL 文と
// バインド値が丸ごとログ基盤へ載りうる。pino へ委譲して出力経路を1本にする。
type BetterAuthLogLevel = "debug" | "info" | "warn" | "error";

export type AuthLogger = Record<BetterAuthLogLevel, (obj: unknown, msg?: string) => void>;

export function toBetterAuthLoggerOption(logger: AuthLogger) {
  return {
    // Better Auth 既定の閾値(warn)をそのまま使う。debug/info は publish されない。
    log: (level: BetterAuthLogLevel, message: string, ...args: unknown[]) => {
      // message は SQL 文などを含みうるので pino の msg に置く(msg は $metadata.error に
      // 取り込まれないキー)。args は Better Auth が付ける補足情報で、構造化して残す。
      logger[level](args.length > 0 ? { betterAuthArgs: args } : {}, message);
    },
  };
}

export function createAuth(
  config: AppConfig["auth"],
  nodeEnv: AppConfig["nodeEnv"],
  db: Database,
  logger: AuthLogger,
) {
  const isProduction = nodeEnv === "production";
  return betterAuth({
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: config.trustedOrigins,
    logger: toBetterAuthLoggerOption(logger),
    session: {
      cookieCache: {
        // 署名付き cookie にセッションを最大5分キャッシュし、getSession ごとの
        // auth_sessions への DB 往復（CF Workers では Hyperdrive 経由のネットワーク往復）を省く。
        // トレードオフ: サインアウト・セッション失効の反映が cookie 期限まで（最大5分）遅れる。
        // 即時失効が必要な要件では enabled: false にするか maxAge を短くすること。
        enabled: true,
        maxAge: 5 * 60,
      },
    },
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
