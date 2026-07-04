import type { Task } from "../../domain/models";
import { encodeTaskCursor } from "./cursor";

export type ListTasksResponse = { items: Task[]; nextCursor: string | null };

// hasMore のとき、このページ最後の要素の (createdAt, id) を次ページのカーソルにする
export function toListTasksResponse(result: {
  items: Task[];
  hasMore: boolean;
}): ListTasksResponse {
  const last = result.items.at(-1);
  return {
    items: result.items,
    nextCursor: result.hasMore && last ? encodeTaskCursor(last) : null,
  };
}
