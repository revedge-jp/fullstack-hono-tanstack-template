import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Result } from "neverthrow";

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
  // errorMap に含まれないキーは型違反だが、実行時の安全網として 500 を返す
  return c.json({ ok: false, error: result.error }, status ?? 500);
}
