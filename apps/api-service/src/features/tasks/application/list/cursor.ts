import { err, ok, type Result } from "neverthrow";

// keyset ページネーションのカーソル。(createdAt, id) の複合キーで位置を表す。
// クライアントには不透明な文字列（base64url）として渡し、形式は API の内部実装とする。
export type TaskCursor = { createdAt: Date; id: string };

function toBase64Url(value: string): string {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): string {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

export function encodeTaskCursor(cursor: TaskCursor): string {
  return toBase64Url(JSON.stringify({ t: cursor.createdAt.toISOString(), id: cursor.id }));
}

export function decodeTaskCursor(raw: string): Result<TaskCursor, "InvalidCursor"> {
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(raw));
    if (typeof parsed !== "object" || parsed === null) {
      return err("InvalidCursor" as const);
    }
    const { t, id } = parsed as { t?: unknown; id?: unknown };
    if (typeof t !== "string" || typeof id !== "string" || id.length === 0) {
      return err("InvalidCursor" as const);
    }
    const createdAt = new Date(t);
    if (Number.isNaN(createdAt.getTime())) {
      return err("InvalidCursor" as const);
    }
    return ok({ createdAt, id });
  } catch {
    return err("InvalidCursor" as const);
  }
}
