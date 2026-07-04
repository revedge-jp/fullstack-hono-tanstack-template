import { describe, expect, test } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import { reconstituteTask } from "../../domain/models";
import type { TasksRepository } from "../../domain/tasks.repository";
import { makeListTasks } from "./usecase";

describe("tasks.list usecase", () => {
  test("正常: オーナーのタスク一覧を返す", async () => {
    const tasksRepository: TasksRepository = {
      create: () => errAsync("Unexpected" as const),
      list: ({ ownerId }) =>
        okAsync({
          items: [
            reconstituteTask({
              id: "task-1",
              ownerId,
              title: "Write docs",
              status: "todo",
              createdAt: new Date(),
              updatedAt: new Date(),
            }),
          ],
        }),
      getById: () => okAsync(null),
      update: (task) => okAsync(task),
      delete: () => okAsync(undefined),
    };
    const usecase = makeListTasks({ tasksRepository });

    const r = await usecase({ ownerId: "user-1" });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.items).toHaveLength(1);
      expect(r.value.items[0]?.ownerId).toBe("user-1");
    }
  });

  test("異常: リポジトリが失敗した場合 Unexpected を返す", async () => {
    const tasksRepository: TasksRepository = {
      create: () => errAsync("Unexpected" as const),
      list: () => errAsync("Unexpected" as const),
      getById: () => okAsync(null),
      update: (task) => okAsync(task),
      delete: () => okAsync(undefined),
    };
    const usecase = makeListTasks({ tasksRepository });

    const r = await usecase({ ownerId: "user-1" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Unexpected");
    }
  });
});
