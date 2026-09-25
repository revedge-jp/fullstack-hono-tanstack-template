import { readCauseCode, stringifyErrorSafe } from "@repo/logging";

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

type WarnLogger = { warn: (obj: unknown, msg?: string) => void };

/**
 * DB 障害を "Unexpected" に畳む前に、原因を warn で残す errorMapper を返す。畳んだ後は toHttp の
 * 500 ログに "Unexpected" しか残らず、DB の停止（ECONNREFUSED）とマイグレーションの当て忘れ（42P01）の
 * 区別がつかない。error / err キーは使わない（Errors は toHttp の 500 で 1 件数えるので二重にしない）。
 * Error 本体は渡さない: DrizzleQueryError は message・stack・params にバインド値を持つので、
 * stringifyErrorSafe で切り落とした文字列と SQLSTATE（causeCode）だけにする（.claude/rules/logging.md）。
 */
export function toUnexpectedDbError(logger: WarnLogger, operation: string) {
  return (e: unknown): "Unexpected" => {
    logger.warn(
      { operation, causeCode: readCauseCode(e), detail: stringifyErrorSafe(e) },
      "db_query_failed",
    );
    return "Unexpected";
  };
}
