import type { AppConfig } from "@app/config";
import { authAccounts, authSessions, authUsers, authVerifications, type Database } from "@repo/db";
import { stringifyErrorSafe, stripBindParams } from "@repo/logging";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { isAPIError } from "better-auth/api";

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
  // メッセージがエラー名の一部と一致する(`new Error("Error")` 等)ことがあるので、直後が
  // 改行か末尾になる出現位置まで探す。メッセージの開始はヘッダーの1行目に限る。
  let messageStart = stack.indexOf(message);
  while (messageStart !== -1 && !stack.slice(0, messageStart).includes("\n")) {
    const rest = stack.slice(messageStart + message.length);
    if (rest === "") {
      return "";
    }
    if (rest.startsWith("\n")) {
      return rest.slice(1);
    }
    messageStart = stack.indexOf(message, messageStart + 1);
  }
  return undefined;
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

function toLogMessage(message: unknown): string {
  if (typeof message === "string") {
    return stripBindParams(message);
  }
  return message instanceof Error ? message.name : "";
}

export function toBetterAuthLoggerOption(logger: AuthLogger) {
  return {
    // Better Auth 既定の閾値(warn)をそのまま使う。debug/info は publish されない。
    // 型上は message: string だが、Better Auth は `logger.error(e)` のように Error を第1引数に
    // 渡すことがある(routes/session の listSessions)。@better-auth/core の createLogger は
    // それを加工せず渡してくるので unknown で受ける。
    log: (level: BetterAuthLogLevel, message: unknown, ...args: unknown[]) => {
      // message は SQL 文などを含みうるので pino の msg に置く(msg は $metadata.error に
      // 取り込まれないキー)。Better Auth は DB エラーの message だけを渡すこともあるので
      // (api/index の onError)、ここでもバインド値を切り落とす。args は Better Auth が付ける
      // 補足情報で、構造化して残す。文字列以外の message は msg に置くと own プロパティ
      // (DrizzleQueryError の params)ごと直列化されるので、args の先頭へ回す。
      const allArgs = typeof message === "string" ? args : [message, ...args];
      logger[level](
        allArgs.length > 0 ? { betterAuthArgs: allArgs.map(serializeBetterAuthArg) } : {},
        toLogMessage(message),
      );
    },
  };
}

/**
 * `auth.api.*` の reject が Better Auth の APIError なら、値を含まない識別子だけを返す。
 * getSession は APIError 以外の例外(DB 障害の DrizzleQueryError 等)を内蔵ロガーで記録したうえで
 * APIError(INTERNAL_SERVER_ERROR) に包み直して投げるので、呼び出し側に届くのは通常こちら。
 */
export function readAuthApiError(error: unknown) {
  if (!(error instanceof Error) || !isAPIError(error)) {
    return undefined;
  }
  // status は他のログ(request-logger / to-http)では数値の HTTP ステータスなので、APIError の
  // 文字列の status("UNAUTHORIZED" 等)は別名にして型を混在させない。
  return {
    name: error.name,
    apiStatus: readPrimitiveField(error, "status"),
    statusCode: readPrimitiveField(error, "statusCode"),
    bodyCode: readBodyCode(error),
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
        // 同じブラウザでも、サインアウトの直前に出ていたリクエストがその日の延長に当たり、サインアウトの
        // 後に応答が届くと、延長した session_token と cookieCache を書き戻して最大5分サインイン状態に戻る
        // （requireAuth が Set-Cookie を返すため。延長に当たらなければ session_token が無いので戻らない）。
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
