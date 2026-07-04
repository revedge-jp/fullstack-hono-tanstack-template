function readCode(e: unknown): string | undefined {
  if (typeof e !== "object" || e === null) {
    return undefined;
  }
  if ("code" in e && typeof e.code === "string") {
    return e.code;
  }
  return undefined;
}

/**
 * postgres.js が投げるエラーの PostgreSQL エラーコードをダックタイピングで判定する。
 * drizzle-orm は実際の PostgresError を DrizzleQueryError でラップし `.cause` に格納するため、
 * トップレベルと `.cause` の両方を確認する。
 * 例: 23505 = unique_violation, 23503 = foreign_key_violation
 */
export function isPgError(e: unknown, code: string): boolean {
  const topLevelCode = readCode(e);
  if (topLevelCode === code) {
    return true;
  }

  const cause = typeof e === "object" && e !== null && "cause" in e ? e.cause : undefined;
  return readCode(cause) === code;
}
