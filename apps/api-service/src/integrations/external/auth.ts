import type { AppConfig } from "@app/config";
import { authAccounts, authSessions, authUsers, authVerifications, type Database } from "@repo/db";
import { stringifyErrorSafe } from "@repo/logging";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

// Better Auth の内蔵ロガー(@better-auth/core の createLogger)は options.logger が未指定だと
// 自前の console.error/warn/log で出力する。それはこのアプリの pino を通らないため、
// (1) @repo/logging の redact が効かない、(2) 生の console.error はメッセージ全文がそのまま
// Cloudflare の `$metadata.error` に入る、という2点で問題になる。DB 障害時には SQL 文と
// バインド値が丸ごとログ基盤へ載りうる。pino へ委譲して出力経路を1本にする。
type BetterAuthLogLevel = "debug" | "info" | "warn" | "error";

export type AuthLogger = Record<BetterAuthLogLevel, (obj: unknown, msg?: string) => void>;

// DrizzleQueryError はメッセージ末尾に `\nparams: <バインド値>` を埋め込む。pino の redact は
// キー単位でしか効かず文字列の中身には届かないため、ここで切り落とす(SQL 文は残す)。
const BIND_PARAMS_MARKER = "\nparams:";

function stripBindParams(message: string): string {
  const markerIndex = message.indexOf(BIND_PARAMS_MARKER);
  return markerIndex === -1 ? message : message.slice(0, markerIndex);
}

// stack の先頭行(複数行メッセージなら複数行)はメッセージの複製でバインド値を含みうるので、
// 呼び出しフレームの行だけを残す。
function extractStackFrames(stack: string): string {
  return stack
    .split("\n")
    .filter((line) => line.trimStart().startsWith("at "))
    .join("\n");
}

// cause が Error 以外のオブジェクトなら JSON 全体が文字列になり、redact は掛からない
// (DrizzleQueryError の cause は postgres.js の Error なのでこの経路は通らない)。
function describeCause(cause: unknown): string {
  if (cause instanceof Error) {
    return `${cause.name}: ${stripBindParams(cause.message)}`;
  }
  return stringifyErrorSafe(cause);
}

// pino の既定シリアライザが Error を直列化するのはトップレベルの `err` だけで、それ以外の
// 位置の Error は JSON.stringify で `{}` になる(message も stack も消える)。一方 `err` /
// `error` は 5xx 専用の予約キーなので、Better Auth の warn ログをそこへ載せることはできない。
// そのため betterAuthArgs の中で Error を平たいオブジェクトに置き換える。own プロパティは
// 展開しない(DrizzleQueryError は `params` にバインド値を持つ)。
function serializeBetterAuthArg(arg: unknown): unknown {
  if (!(arg instanceof Error)) {
    return arg;
  }
  return {
    name: arg.name,
    message: stripBindParams(arg.message),
    ...(arg.stack === undefined ? {} : { stack: extractStackFrames(arg.stack) }),
    ...(arg.cause === undefined ? {} : { cause: describeCause(arg.cause) }),
  };
}

export function toBetterAuthLoggerOption(logger: AuthLogger) {
  return {
    // Better Auth 既定の閾値(warn)をそのまま使う。debug/info は publish されない。
    log: (level: BetterAuthLogLevel, message: string, ...args: unknown[]) => {
      // message は SQL 文などを含みうるので pino の msg に置く(msg は $metadata.error に
      // 取り込まれないキー)。args は Better Auth が付ける補足情報で、構造化して残す。
      logger[level](
        args.length > 0 ? { betterAuthArgs: args.map(serializeBetterAuthArg) } : {},
        message,
      );
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
