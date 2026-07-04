import type { ResultAsync } from "neverthrow";
import type { Task, TaskTitle } from "./models";

export type TasksRepository = {
  create(input: {
    ownerId: string;
    title: TaskTitle;
  }): ResultAsync<Task, "Conflict" | "Unexpected">;
  list(input: { ownerId: string }): ResultAsync<{ items: Task[] }, "Unexpected">;
  // 所有者が異なる場合も null（NotFound と区別しない。他ユーザーのタスクの存在を漏らさないため）
  getById(id: string, ownerId: string): ResultAsync<Task | null, "Unexpected">;
  update(task: Task): ResultAsync<Task, "NotFound" | "Unexpected">;
  delete(id: string, ownerId: string): ResultAsync<void, "NotFound" | "Unexpected">;
};
