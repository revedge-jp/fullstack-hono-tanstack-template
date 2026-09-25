/**
 * Error の cause が持つ文字列の `code`(SQLSTATE・ECONNREFUSED 等)を返す。
 *
 * DrizzleQueryError のメッセージは SQL 文だけで、DB 停止(ECONNREFUSED)・テーブル欠落(42P01)・
 * 制約違反(23505)等の区別は cause にしかない。cause.message は入力値を埋め込むことがある
 * (`invalid input syntax for type uuid: "…"`)ので、値を含まない code だけを取り出す。
 */
export function readCauseCode(err: unknown): string | undefined {
  if (!(err instanceof Error) || typeof err.cause !== "object" || err.cause === null) {
    return undefined;
  }
  return "code" in err.cause && typeof err.cause.code === "string" ? err.cause.code : undefined;
}
