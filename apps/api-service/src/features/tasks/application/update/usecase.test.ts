import { describe, expect, test } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import { reconstituteTask } from "../../domain/models";
import type { TasksRepository } from "../../domain/tasks.repository";
import { makeAdvanceTask } from "./usecase";

function buildTask(status: "todo" | "in_progress" | "done") {
  return reconstituteTask({
    id: "task-1",
    ownerId: "user-1",
    title: "Write docs",
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

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

describe("tasks.advanceTask usecase", () => {
  test("正常: todo のタスクを in_progress に進める", async () => {
    const tasksRepository = buildRepo({ getById: () => okAsync(buildTask("todo")) });
    const usecase = makeAdvanceTask({ tasksRepository });

    const r = await usecase({ id: "task-1", ownerId: "user-1" });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.status).toBe("in_progress");
    }
  });

  test("異常: 存在しないタスクは NotFound を返す", async () => {
    const tasksRepository = buildRepo({ getById: () => okAsync(null) });
    const usecase = makeAdvanceTask({ tasksRepository });

    const r = await usecase({ id: "unknown", ownerId: "user-1" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("NotFound");
    }
  });

  test("異常: done のタスクは AlreadyDone を返す", async () => {
    const tasksRepository = buildRepo({ getById: () => okAsync(buildTask("done")) });
    const usecase = makeAdvanceTask({ tasksRepository });

    const r = await usecase({ id: "task-1", ownerId: "user-1" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("AlreadyDone");
    }
  });
});
