import { describe, expect, test } from "bun:test";

import { errAsync, okAsync } from "neverthrow";

import { reconstituteTask } from "../../domain/models";
import type { TasksRepository } from "../../domain/tasks.repository";
import { decodeTaskCursor, encodeTaskCursor } from "./cursor";
import { makeListTasks } from "./usecase";
import { DEFAULT_TASKS_PAGE_SIZE } from "./validators";

function buildTask(id: string, createdAt: Date) {
  return reconstituteTask({
    id,
    ownerId: "user-1",
    title: `Task ${id}`,
    status: "todo",
    createdAt,
    updatedAt: createdAt,
  });
}

function buildRepo(overrides: Partial<TasksRepository> = {}): TasksRepository {
  return {
    create: () => errAsync("Unexpected" as const),
    list: () => okAsync({ items: [], hasMore: false }),
    getById: () => okAsync(null),
    update: (task) => okAsync(task),
    delete: () => okAsync(undefined),
    ...overrides,
  };
}

describe("tasks.list usecase", () => {
  test("正常: オーナーのタスク一覧を返す（次ページなしなら nextCursor は null）", async () => {
    let receivedLimit: number | undefined;
    const tasksRepository = buildRepo({
      list: ({ limit }) => {
        receivedLimit = limit;
        return okAsync({
          items: [buildTask("task-1", new Date("2026-07-04T09:00:00Z"))],
          hasMore: false,
        });
      },
    });
    const usecase = makeListTasks({ tasksRepository });

    const r = await usecase({ ownerId: "user-1" });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.items).toHaveLength(1);
      expect(r.value.nextCursor).toBeNull();
    }
    expect(receivedLimit).toBe(DEFAULT_TASKS_PAGE_SIZE);
  });

  test("正常: 次ページがある場合、最後の要素を指す nextCursor を返す", async () => {
    const lastCreatedAt = new Date("2026-07-04T08:00:00Z");
    const tasksRepository = buildRepo({
      list: () =>
        okAsync({
          items: [
            buildTask("task-1", new Date("2026-07-04T09:00:00Z")),
            buildTask("task-2", lastCreatedAt),
          ],
          hasMore: true,
        }),
    });
    const usecase = makeListTasks({ tasksRepository });

    const r = await usecase({ ownerId: "user-1", limit: 2 });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.nextCursor).not.toBeNull();
      const decoded = decodeTaskCursor(r.value.nextCursor ?? "");
      expect(decoded.isOk()).toBe(true);
      if (decoded.isOk()) {
        expect(decoded.value.id).toBe("task-2");
        expect(decoded.value.createdAt.toISOString()).toBe(lastCreatedAt.toISOString());
      }
    }
  });

  test("正常: cursor を渡すとデコードされた after がリポジトリに届く", async () => {
    const after = { createdAt: new Date("2026-07-04T08:00:00Z"), id: "task-2" };
    let receivedAfter: { createdAt: Date; id: string } | undefined;
    const tasksRepository = buildRepo({
      list: (input) => {
        receivedAfter = input.after;
        return okAsync({ items: [], hasMore: false });
      },
    });
    const usecase = makeListTasks({ tasksRepository });

    const r = await usecase({ ownerId: "user-1", cursor: encodeTaskCursor(after) });
    expect(r.isOk()).toBe(true);
    expect(receivedAfter?.id).toBe("task-2");
    expect(receivedAfter?.createdAt.toISOString()).toBe(after.createdAt.toISOString());
  });

  test("異常: 不正な cursor は Invalid を返す（DB には触れない）", async () => {
    const tasksRepository = buildRepo({
      list: () => {
        throw new Error("list should not be called for an invalid cursor");
      },
    });
    const usecase = makeListTasks({ tasksRepository });

    const r = await usecase({ ownerId: "user-1", cursor: "!!!broken!!!" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Invalid");
    }
  });

  test("異常: limit が範囲外の場合 Invalid を返す", async () => {
    const usecase = makeListTasks({ tasksRepository: buildRepo() });
    expect((await usecase({ ownerId: "user-1", limit: 0 })).isErr()).toBe(true);
    expect((await usecase({ ownerId: "user-1", limit: 101 })).isErr()).toBe(true);
    expect((await usecase({ ownerId: "user-1", limit: 1.5 })).isErr()).toBe(true);
  });

  test("正常: limit の境界値 1 と 100 は許可される", async () => {
    const usecase = makeListTasks({ tasksRepository: buildRepo() });
    expect((await usecase({ ownerId: "user-1", limit: 1 })).isOk()).toBe(true);
    expect((await usecase({ ownerId: "user-1", limit: 100 })).isOk()).toBe(true);
  });

  test("異常: リポジトリが失敗した場合 Unexpected を返す", async () => {
    const tasksRepository = buildRepo({ list: () => errAsync("Unexpected" as const) });
    const usecase = makeListTasks({ tasksRepository });

    const r = await usecase({ ownerId: "user-1" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Unexpected");
    }
  });
});
