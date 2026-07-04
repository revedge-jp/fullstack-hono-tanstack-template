import { describe, expect, test } from "bun:test";
import { errAsync, okAsync } from "neverthrow";
import { reconstituteTask } from "../../domain/models";
import type { TasksRepository } from "../../domain/tasks.repository";
import type { ActivityRecorder } from "../ports";
import { makeCreateTask } from "./usecase";

const ID_1 = "task-1";

function buildRepo(overrides: Partial<TasksRepository> = {}): TasksRepository {
  return {
    create: () =>
      okAsync(
        reconstituteTask({
          id: ID_1,
          ownerId: "user-1",
          title: "Write docs",
          status: "todo",
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
    list: () => okAsync({ items: [] }),
    getById: () => okAsync(null),
    update: (task) => okAsync(task),
    delete: () => okAsync(undefined),
    ...overrides,
  };
}

function buildActivityRecorder(overrides: Partial<ActivityRecorder> = {}): ActivityRecorder {
  return {
    recordTaskCreated: () => okAsync(undefined),
    ...overrides,
  };
}

describe("tasks.create usecase", () => {
  test("正常: 有効な入力でタスクを作成し activity を記録する", async () => {
    let recordedTaskId: string | undefined;
    const tasksRepository = buildRepo();
    const activityRecorder = buildActivityRecorder({
      recordTaskCreated: (task) => {
        recordedTaskId = task.id;
        return okAsync(undefined);
      },
    });
    const usecase = makeCreateTask({ tasksRepository, activityRecorder });

    const r = await usecase({ ownerId: "user-1", title: "Write docs" });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.item.id).toBe(ID_1);
    }
    expect(recordedTaskId).toBe(ID_1);
  });

  test("異常: タイトルが空の場合 Invalid を返す", async () => {
    const tasksRepository = buildRepo();
    const activityRecorder = buildActivityRecorder();
    const usecase = makeCreateTask({ tasksRepository, activityRecorder });

    const r = await usecase({ ownerId: "user-1", title: "   " });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Invalid");
    }
  });

  test("異常: タイトル重複で Conflict を返す", async () => {
    const tasksRepository = buildRepo({ create: () => errAsync("Conflict" as const) });
    const activityRecorder = buildActivityRecorder();
    const usecase = makeCreateTask({ tasksRepository, activityRecorder });

    const r = await usecase({ ownerId: "user-1", title: "Write docs" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Conflict");
    }
  });

  test("異常: activity 記録が失敗した場合 Unexpected を返す(fail-closed)", async () => {
    const tasksRepository = buildRepo();
    const activityRecorder = buildActivityRecorder({
      recordTaskCreated: () => errAsync("Unexpected" as const),
    });
    const usecase = makeCreateTask({ tasksRepository, activityRecorder });

    const r = await usecase({ ownerId: "user-1", title: "Write docs" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Unexpected");
    }
  });
});
