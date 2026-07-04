import { describe, expect, test } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import type { TasksRepository } from "../../domain/tasks.repository";
import { makeDeleteTask } from "./usecase";

function buildRepo(overrides: Partial<TasksRepository> = {}): TasksRepository {
  return {
    create: () => errAsync("Unexpected" as const),
    list: () => okAsync({ items: [] }),
    getById: () => okAsync(null),
    update: (task) => okAsync(task),
    delete: () => okAsync(undefined),
    ...overrides,
  };
}

describe("tasks.delete usecase", () => {
  test("正常: タスクを削除する", async () => {
    const tasksRepository = buildRepo({ delete: () => okAsync(undefined) });
    const usecase = makeDeleteTask({ tasksRepository });

    const r = await usecase({ id: "task-1", ownerId: "user-1" });
    expect(r.isOk()).toBe(true);
  });

  test("異常: 存在しない(または他ユーザーの)場合 NotFound を返す", async () => {
    const tasksRepository = buildRepo({ delete: () => errAsync("NotFound" as const) });
    const usecase = makeDeleteTask({ tasksRepository });

    const r = await usecase({ id: "unknown", ownerId: "user-1" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("NotFound");
    }
  });
});
