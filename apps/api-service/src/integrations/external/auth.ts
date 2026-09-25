import type { AppConfig } from "@app/config";
import { authAccounts, authSessions, authUsers, authVerifications, type Database } from "@repo/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

// Better Auth の出力のうち生の console に出る経路は2つあり、どちらもこのアプリの pino を
// 通らないため、(1) @repo/logging の redact が効かない、(2) 生の console.error はメッセージ全文が
// そのまま Cloudflare の `$metadata.error` に入る、という2点で問題になる。DB 障害時には SQL 文と
// バインド値(OAuth の codeVerifier 等)が丸ごとログ基盤へ載る。
// - 内蔵ロガー(@better-auth/core の createLogger): options.logger が未指定だと自前の
//   console.error/warn/log で出力する → logger オプションで pino へ委譲する
// - ルーター(better-call の createRouter): APIError 以外の例外は logger オプションと無関係に
//   `console.error("# SERVER_ERROR: ", error)` で出す → createAuth の onAPIError で
//   Hono へ再送出させ、app.ts の onError(pino・本番マスキング)に任せる
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
    // APIError 以外の例外(DB 障害時の DrizzleQueryError 等)を auth.handler の外へ投げ、
    // better-call の console.error を通さない。APIError は 4xx・500 とも、これまでどおり
    // better-call がレスポンスに変換する(再送出しても better-call が APIError だけは拾い直す)。
    // 副作用として Better Auth 既定のルーター側エラーログ(APIError 500 の ctx.logger.error)も
    // 走らなくなるので、5xx レスポンスのログは app.ts の /api/auth/* ルートで出す。
    onAPIError: { throw: true },
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
