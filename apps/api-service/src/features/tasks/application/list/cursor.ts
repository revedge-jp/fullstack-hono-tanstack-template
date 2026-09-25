import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

// keyset ページネーションのカーソル。(createdAt, id) の複合キーで位置を表す。
// クライアントには不透明な文字列（base64url）として渡し、形式は API の内部実装とする。
export type TaskCursor = { createdAt: Date; id: string };

function toBase64Url(value: string): string {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

// パディングは補わない: atob は WHATWG の forgiving-base64 で、末尾の "=" が無くても復号する
// （Bun / workerd とも）。
function fromBase64Url(value: string): string {
  return atob(value.replaceAll("-", "+").replaceAll("_", "/"));
}

const CursorPayloadSchema = z.object({ t: z.string(), id: z.string().min(1) });

export function encodeTaskCursor(cursor: TaskCursor): string {
  return toBase64Url(JSON.stringify({ t: cursor.createdAt.toISOString(), id: cursor.id }));
}

export function decodeTaskCursor(raw: string): Result<TaskCursor, "InvalidCursor"> {
  let json: unknown;
  try {
    json = JSON.parse(fromBase64Url(raw));
  } catch {
    return err("InvalidCursor" as const);
  }
  const payload = CursorPayloadSchema.safeParse(json);
  if (!payload.success) {
    return err("InvalidCursor" as const);
  }
  const createdAt = new Date(payload.data.t);
  if (Number.isNaN(createdAt.getTime())) {
    return err("InvalidCursor" as const);
  }
  // JS の Date として正しくても、PostgreSQL の timestamptz が受け付けない年（0 年以前・10000 年以降）は
  // 比較の時点で 22007 / 22008 / 22009 になり 500 になる。エンコーダは 4 桁の年しか出さないので、改ざん・破損として弾く
  const year = createdAt.getUTCFullYear();
  if (year < 1 || year > 9999) {
    return err("InvalidCursor" as const);
  }
  return ok({ createdAt, id: payload.data.id });
}
