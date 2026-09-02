import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Result } from "neverthrow";

// requestLogger ミドルウェアが context に載せるロガーの最小型(middlewares/request-logger.ts
// の RequestLogger と構造的に一致する範囲だけをここで定義し、shared → middlewares の
// import を作らない)。
type ErrorLogger = {
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
};

// エラー応答の理由をアクセスログと同じ requestId で相関できるよう構造化ログに残す。
// アクセスログには status しか残らず、本番で「なぜ 400/409 になったか」を後から特定できない
// ため。5xx は想定外(バグの兆候)なので error、4xx は業務上の拒否なので warn に分ける。
//
// フィールド名を 4xx と 5xx で変えているのは Cloudflare Workers Observability の都合。
// CF は `error` / `err` キーの値を `$metadata.error` に取り込み、ダッシュボードの既定フィルタ
// `exists($metadata.error)` がそれを「Errors」として数える。4xx も `error` で出すと、
// 正常な 401(未ログイン訪問)だけで Errors が埋まり、本物の異常(5xx)がその中に埋もれる。
// 4xx は業務上の拒否であって異常ではないので、取り込み対象外の `errorCode` に載せる
// (このキーが対象外であることは実測済み — packages/logging/src/create-logger.ts の
// コメント参照)。4xx の検索性は `msg: "request_error"` + `status` + `errorCode` で担保する。
function logErrorResponse(c: Context, errorCode: string, status: number): void {
  const logger: ErrorLogger | undefined = c.get("logger");
  if (!logger) {
    return;
  }
  if (status >= 500) {
    logger.error({ error: errorCode, status }, "request_error");
  } else {
    logger.warn({ errorCode, status }, "request_error");
  }
}

/**
 * Result を { ok: true, data } / { ok: false, error } の HTTP レスポンスに変換する。
 * errorMap は E の全ケースを網羅する必要があり、網羅漏れはコンパイルエラーになる。
 */
export function toHttp<T, E extends string>(
  c: Context,
  result: Result<T, E>,
  errorMap: Record<E, ContentfulStatusCode>,
  okStatus: ContentfulStatusCode = 200,
) {
  if (result.isOk()) {
    return c.json({ ok: true, data: result.value }, okStatus);
  }
  const status = errorMap[result.error];
  logErrorResponse(c, result.error, status ?? 500);
  // errorMap に含まれないキーは型違反だが、実行時の安全網として 500 を返す
  return c.json({ ok: false, error: result.error }, status ?? 500);
}

/**
 * void を返す Result(delete 等)を 204(ボディ無し) / { ok: false, error } の
 * HTTP レスポンスに変換する。toHttp と分けているのは、成功時に data フィールドを持つ
 * JSON を返さず c.body(null, 204) にしたいため(DELETE エンドポイントの規約)。
 */
export function toEmptyHttp<E extends string>(
  c: Context,
  result: Result<void, E>,
  errorMap: Record<E, ContentfulStatusCode>,
) {
  if (result.isOk()) {
    return c.body(null, 204);
  }
  const status = errorMap[result.error];
  logErrorResponse(c, result.error, status ?? 500);
  return c.json({ ok: false, error: result.error }, status ?? 500);
}
