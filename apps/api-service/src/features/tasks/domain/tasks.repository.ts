import type { ResultAsync } from "neverthrow";
import type { Task, TaskTitle } from "./models";

export type TasksRepository = {
  create(input: {
    ownerId: string;
    title: TaskTitle;
  }): ResultAsync<Task, "Conflict" | "Unexpected">;
  // keyset ページネーション: (createdAt, id) の降順で after より後ろのページを limit 件返す。
  // hasMore は「次のページが存在するか」（limit+1 件フェッチで判定）。
  list(input: {
    ownerId: string;
    limit: number;
    after?: { createdAt: Date; id: string };
  }): ResultAsync<{ items: Task[]; hasMore: boolean }, "Unexpected">;
  // 所有者が異なる場合も null（NotFound と区別しない。他ユーザーのタスクの存在を漏らさないため）
  getById(id: string, ownerId: string): ResultAsync<Task | null, "Unexpected">;
  update(task: Task): ResultAsync<Task, "NotFound" | "Unexpected">;
  delete(id: string, ownerId: string): ResultAsync<void, "NotFound" | "Unexpected">;
};
