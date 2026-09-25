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

// PostgreSQL のデータ例外(SQLSTATE 22xxx。22P02 invalid input syntax 等)はメッセージに
// 入力値そのものを含めるので、メッセージを出さずコードだけ残す。
function isDataExceptionCode(code: string | number | undefined): boolean {
  return typeof code === "string" && /^22[0-9A-Z]{3}$/.test(code);
}

function readPrimitiveField(value: object, key: string): string | number | undefined {
  if (!(key in value)) {
    return undefined;
  }
  const field: unknown = Reflect.get(value, key);
  return typeof field === "string" || typeof field === "number" ? field : undefined;
}

// Better Auth の APIError は `body.code`(FAILED_TO_CREATE_SESSION 等)に原因の種別を持つ。
function readBodyCode(error: Error): string | number | undefined {
  const body: unknown = "body" in error ? error.body : undefined;
  return typeof body === "object" && body !== null ? readPrimitiveField(body, "code") : undefined;
}

// stack の先頭(複数行メッセージなら複数行)はメッセージの複製でバインド値を含みうる。行の形では
// なく位置で切り落とし、メッセージより後ろの呼び出しフレームだけを返す。stack 中にメッセージが
// 見つからない(生成後に message が書き換えられた等)ときは、安全側に倒して undefined を返す。
function extractStackFrames(stack: string, message: string): string | undefined {
  if (message === "") {
    const headerEnd = stack.indexOf("\n");
    return headerEnd === -1 ? "" : stack.slice(headerEnd + 1);
  }
  const messageStart = stack.indexOf(message);
  if (messageStart === -1 || stack.slice(0, messageStart).includes("\n")) {
    return undefined;
  }
  const rest = stack.slice(messageStart + message.length);
  if (rest === "") {
    return "";
  }
  return rest.startsWith("\n") ? rest.slice(1) : undefined;
}

// better-call の APIError は Error.stackTraceLimit = 0 で生成されるので stack にフレームが無い。
// 本来のフレームは prototype の getter `errorStack` にあり、その先頭行はメッセージを含まない
// エラー名だけになっている。
function collectStackFrames(error: Error): string | undefined {
  const frames =
    error.stack === undefined ? undefined : extractStackFrames(error.stack, error.message);
  if (frames !== undefined && frames !== "") {
    return frames;
  }
  if ("errorStack" in error && typeof error.errorStack === "string") {
    return extractStackFrames(error.errorStack, "");
  }
  return frames;
}

// cause が Error 以外のオブジェクトなら JSON 全体が文字列になり、redact は掛からない
// (DrizzleQueryError の cause は postgres.js の Error なのでこの経路は通らない)。
function describeCause(cause: unknown): string {
  if (!(cause instanceof Error)) {
    return stringifyErrorSafe(cause);
  }
  const code = readPrimitiveField(cause, "code");
  const label = code === undefined ? cause.name : `${cause.name} [${code}]`;
  return isDataExceptionCode(code) ? label : `${label}: ${stripBindParams(cause.message)}`;
}

// pino の既定シリアライザが Error を直列化するのはトップレベルの `err` だけで、それ以外の
// 位置の Error は JSON.stringify で `{}` になる(message も stack も消える)。一方 `err` /
// `error` は 5xx 専用の予約キーなので、Better Auth の warn ログをそこへ載せることはできない。
// そのため betterAuthArgs の中で Error を平たいオブジェクトに置き換える。own プロパティは
// 展開せず、値を含まない識別子(APIError の status / statusCode / body.code、postgres.js の
// SQLSTATE `code`)だけを許可リストで残す。DrizzleQueryError の `params` や PostgresError の
// `detail`(`Key (email)=(...)`)はバインド値を含むため出さない。
function serializeBetterAuthArg(arg: unknown): unknown {
  if (!(arg instanceof Error)) {
    return arg;
  }
  const code = readPrimitiveField(arg, "code");
  const stack = collectStackFrames(arg);
  return {
    name: arg.name,
    ...(isDataExceptionCode(code) ? {} : { message: stripBindParams(arg.message) }),
    status: readPrimitiveField(arg, "status"),
    statusCode: readPrimitiveField(arg, "statusCode"),
    code,
    bodyCode: readBodyCode(arg),
    ...(stack === undefined ? {} : { stack }),
    ...(arg.cause === undefined ? {} : { cause: describeCause(arg.cause) }),
  };
}

export function toBetterAuthLoggerOption(logger: AuthLogger) {
  return {
    // Better Auth 既定の閾値(warn)をそのまま使う。debug/info は publish されない。
    log: (level: BetterAuthLogLevel, message: string, ...args: unknown[]) => {
      // message は SQL 文などを含みうるので pino の msg に置く(msg は $metadata.error に
      // 取り込まれないキー)。Better Auth は DB エラーの message だけを渡すこともあるので
      // (api/index の onError)、ここでもバインド値を切り落とす。args は Better Auth が付ける
      // 補足情報で、構造化して残す。
      logger[level](
        args.length > 0 ? { betterAuthArgs: args.map(serializeBetterAuthArg) } : {},
        stripBindParams(message),
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
