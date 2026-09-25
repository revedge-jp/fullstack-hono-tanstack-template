import type { ActivityRepository } from "@app/features/activity/domain/activity.repository";
import { type Activity, reconstituteActivity } from "@app/features/activity/domain/models";
import { type Task, reconstituteTask } from "@app/features/tasks/domain/models";
import type { TasksRepository } from "@app/features/tasks/domain/tasks.repository";
import { errAsync, okAsync } from "neverthrow";

// createFakeApp が使う in-memory リポジトリ。contract テスト等はこれの上で緑になるので、
// Drizzle 実装と挙動がずれると「テストは緑・本番は別の挙動」になる。ずれは
// __tests__/integration/repository-conformance.int.test.ts が同じテストを両方に流して検出する。
// 挙動を変えるときは Drizzle 実装を正として合わせ、適合テストにケースを足すこと。

// Drizzle 実装の一覧の上限（activity.repository.drizzle.ts の limit）と揃える
const ACTIVITY_LIST_LIMIT = 50;

function byCreatedDesc(a: Task, b: Task): number {
  const diff = b.createdAt.getTime() - a.createdAt.getTime();
  return diff !== 0 ? diff : b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
}

export function createInMemoryTasksRepository(seed: Task[] = []): TasksRepository {
  const store = new Map<string, Task>(seed.map((t) => [t.id, t]));
  return {
    create: ({ ownerId, title }) => {
      for (const t of store.values()) {
        if (t.ownerId === ownerId && t.title === title) {
          return errAsync("Conflict" as const);
        }
      }
      const now = new Date();
      const task = reconstituteTask({
        id: crypto.randomUUID(),
        ownerId,
        title,
        status: "todo",
        createdAt: now,
        updatedAt: now,
      });
      store.set(task.id, task);
      return okAsync(task);
    },
    list: ({ ownerId, limit, after }) => {
      let items = [...store.values()].filter((t) => t.ownerId === ownerId).sort(byCreatedDesc);
      if (after) {
        items = items.filter(
          (t) =>
            t.createdAt.getTime() < after.createdAt.getTime() ||
            (t.createdAt.getTime() === after.createdAt.getTime() && t.id < after.id),
        );
      }
      const hasMore = items.length > limit;
      return okAsync({ items: items.slice(0, limit), hasMore });
    },
    getById: (id, ownerId) => {
      const t = store.get(id);
      return okAsync(t && t.ownerId === ownerId ? t : null);
    },
    // Drizzle 実装は id と ownerId の両方で絞り、更新するのは status と updatedAt だけ。
    // 所有者が違えば NotFound（他人のタスクを上書きしない）、updatedAt は更新時刻にする。
    update: (task) => {
      const current = store.get(task.id);
      if (!current || current.ownerId !== task.ownerId) {
        return errAsync("NotFound" as const);
      }
      const updated = reconstituteTask({ ...current, status: task.status, updatedAt: new Date() });
      store.set(updated.id, updated);
      return okAsync(updated);
    },
    delete: (id, ownerId) => {
      const t = store.get(id);
      if (!t || t.ownerId !== ownerId) {
        return errAsync("NotFound" as const);
      }
      store.delete(id);
      return okAsync(undefined);
    },
  };
}

export function createInMemoryActivityRepository(seed: Activity[] = []): ActivityRepository {
  const store: Activity[] = [...seed];
  return {
    record: ({ ownerId, kind, message }) => {
      const activity = reconstituteActivity({
        id: crypto.randomUUID(),
        ownerId,
        kind,
        message,
        occurredAt: new Date(),
      });
      store.push(activity);
      return okAsync(activity);
    },
    list: ({ ownerId }) =>
      okAsync({
        items: store
          .filter((a) => a.ownerId === ownerId)
          .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
          .slice(0, ACTIVITY_LIST_LIMIT),
      }),
  };
}
