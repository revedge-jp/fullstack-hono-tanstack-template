import type { ResultAsync } from "neverthrow";

import type { Task, TaskStatus, TaskTitle } from "./models";

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
  // expected は「読んだ時点の status」。その間に他のリクエストが status を変えていたら更新せず Conflict
  // （楽観ロック。読んでから書くまでの競合で、完了済みのタスクが古い読み取りで巻き戻らないようにする）
  update(
    task: Task,
    expected: { status: TaskStatus },
  ): ResultAsync<Task, "NotFound" | "Conflict" | "Unexpected">;
  delete(id: string, ownerId: string): ResultAsync<void, "NotFound" | "Unexpected">;
};
