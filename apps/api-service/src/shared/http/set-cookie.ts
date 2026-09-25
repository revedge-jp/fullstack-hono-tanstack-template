import type { Context } from "hono";

// Set-Cookie は 1 つずつ別のヘッダーとして付ける（カンマで結合すると、Expires の日付に含まれる
// カンマと区別できなくなる）。
export function appendSetCookieHeaders(c: Context, setCookieHeaders: readonly string[]): void {
  for (const value of setCookieHeaders) {
    c.header("set-cookie", value, { append: true });
  }
}
