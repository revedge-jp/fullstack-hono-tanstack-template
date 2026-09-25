import { stripBindParams } from "./strip-bind-params.js";

/**
 * 任意のオブジェクトを安全に文字列化する（循環参照に対応）。
 * Error のメッセージに埋め込まれた SQL のバインド値は切り落とす。
 */
export function stringifyErrorSafe(err: unknown): string {
  if (err instanceof Error) {
    return stripBindParams(err.message);
  }
  if (typeof err === "object" && err !== null) {
    try {
      return JSON.stringify(err);
    } catch {
      // 循環参照などで JSON 化できない値。型名だけでも残す。プロパティ参照自体が throw する
      // Proxy もありうるので、ここでも例外を外に出さない
      try {
        return `[unserializable ${err.constructor?.name ?? "object"}]`;
      } catch {
        return "[unserializable object]";
      }
    }
  }
  return String(err);
}
