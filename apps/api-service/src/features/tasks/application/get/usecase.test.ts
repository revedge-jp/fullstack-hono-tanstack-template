import { describe, expect, test } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import { reconstituteTask, type TaskId } from "../../domain/models";
import type { TasksRepository } from "../../domain/tasks.repository";
import { makeGetTask } from "./usecase";

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

describe("tasks.get usecase", () => {
  test("正常: 存在するタスクを返す", async () => {
    const task = reconstituteTask({
      id: "task-1",
      ownerId: "user-1",
      title: "Write docs",
      status: "todo",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const tasksRepository = buildRepo({ getById: () => okAsync(task) });
    const usecase = makeGetTask({ tasksRepository });

    const r = await usecase({ id: "task-1", ownerId: "user-1" });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.id).toBe("task-1" as TaskId);
    }
  });

  test("異常: 存在しない(または他ユーザーの)場合 NotFound を返す", async () => {
    const tasksRepository = buildRepo({ getById: () => okAsync(null) });
    const usecase = makeGetTask({ tasksRepository });

    const r = await usecase({ id: "unknown", ownerId: "user-1" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("NotFound");
    }
  });
});
