/**
 * 任意のオブジェクトを安全に文字列化する（循環参照に対応）
 */
export function stringifyErrorSafe(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "object" && err !== null) {
    try {
      return JSON.stringify(err);
    } catch {
      // 循環参照などで JSON 化できない値の最終手段。"[object Object]" になるのは承知の上
      // oxlint-disable-next-line typescript/no-base-to-string
      return String(err);
    }
  }
  return String(err);
}
