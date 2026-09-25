import { afterAll, describe, expect, test } from "bun:test";

import type { ActivityRepository } from "@app/features/activity/domain/activity.repository";
import { createActivityRepository } from "@app/features/activity/infrastructure/activity.repository.drizzle";
import { makeTaskTitle, type TaskId } from "@app/features/tasks/domain/models";
import type { TasksRepository } from "@app/features/tasks/domain/tasks.repository";
import { createTasksRepository } from "@app/features/tasks/infrastructure/tasks.repository.drizzle";
import {
  createInMemoryActivityRepository,
  createInMemoryTasksRepository,
} from "@app/test-helpers/in-memory-repositories";
import { createTransactionalDb } from "@app/test-helpers/transactional-db";
import { authUsers, type Database } from "@repo/db";

// fake↔real 適合テスト。createFakeApp の in-memory リポジトリ（contract テスト等が使う）と Drizzle
// 実装に同じテストを流し、挙動のずれを検出する。ずれていると contract テストは緑のまま、本番だけ
// 別の挙動になる。**Drizzle 実装が正**。落ちたら in-memory 側を直す。
//
// 両方で成り立つ性質だけを書く。1テスト内の Drizzle の行は同じトランザクションなので
// created_at / occurred_at が同時刻になり、in-memory（new Date()）とは時刻の並びが一致しない。
// そのため「並び順そのもの」ではなく、所有者の分離・重複と欠落が無いこと・エラーの種類を見る。
// Drizzle で制約違反（Conflict）を起こすとトランザクションが中断されるので、そのケースは各テストの最後に置く。

const { getDb: getTx, end } = createTransactionalDb(process.env.DATABASE_URL ?? "");

function getDb(): Database {
  return getTx()!;
}

afterAll(async () => {
  await end();
});

type Harness = {
  tasks: TasksRepository;
  activity: ActivityRepository;
  seedOwner: () => Promise<string>;
};

const implementations: { name: string; make: () => Harness }[] = [
  {
    name: "in-memory（createFakeApp）",
    make: () => ({
      tasks: createInMemoryTasksRepository(),
      activity: createInMemoryActivityRepository(),
      seedOwner: async () => `conformance-owner-${crypto.randomUUID()}`,
    }),
  },
  {
    name: "drizzle（実DB）",
    make: () => {
      const db = getDb();
      return {
        tasks: createTasksRepository({ db }),
        activity: createActivityRepository({ db }),
        seedOwner: async () => {
          const id = `conformance-owner-${crypto.randomUUID()}`;
          await db
            .insert(authUsers)
            .values({ id, name: "Conformance", email: `${id}@example.com` });
          return id;
        },
      };
    },
  },
];

function title(value: string) {
  const result = makeTaskTitle(value);
  if (result.isErr()) {
    throw new Error("invalid test fixture title");
  }
  return result.value;
}

async function createTask(repo: TasksRepository, ownerId: string, label = "task") {
  const created = await repo.create({ ownerId, title: title(`${label} ${crypto.randomUUID()}`) });
  if (created.isErr()) {
    throw new Error(`create failed: ${created.error}`);
  }
  return created.value;
}

describe.each(implementations)("TasksRepository の適合: $name", ({ make }) => {
  test("create は todo で作り、getById は所有者にだけ返す", async () => {
    const { tasks, seedOwner } = make();
    const owner = await seedOwner();
    const other = await seedOwner();
    const task = await createTask(tasks, owner);

    expect(task.status).toBe("todo");
    expect(task.ownerId).toBe(owner);
    const mine = await tasks.getById(task.id, owner);
    expect(mine._unsafeUnwrap()?.id).toBe(task.id);
    const theirs = await tasks.getById(task.id, other);
    expect(theirs._unsafeUnwrap()).toBeNull();
    const missing = await tasks.getById(crypto.randomUUID(), owner);
    expect(missing._unsafeUnwrap()).toBeNull();
  });

  test("タイトルの重複は所有者ごと: 別の所有者なら作れ、同じ所有者なら Conflict", async () => {
    const { tasks, seedOwner } = make();
    const owner = await seedOwner();
    const other = await seedOwner();
    const same = title(`dup ${crypto.randomUUID()}`);

    expect((await tasks.create({ ownerId: owner, title: same })).isOk()).toBe(true);
    expect((await tasks.create({ ownerId: other, title: same })).isOk()).toBe(true);
    // Drizzle ではここでトランザクションが中断されるので、以降にクエリを置かない
    const dup = await tasks.create({ ownerId: owner, title: same });
    expect(dup._unsafeUnwrapErr()).toBe("Conflict");
  });

  test("list は所有者で絞り、limit ごとのページで重複も欠落もなく全件を辿れる", async () => {
    const { tasks, seedOwner } = make();
    const owner = await seedOwner();
    const other = await seedOwner();
    const mine = [];
    for (let i = 0; i < 3; i++) {
      mine.push((await createTask(tasks, owner, `mine ${i}`)).id);
    }
    await createTask(tasks, other, "theirs");

    const first = (await tasks.list({ ownerId: owner, limit: 2 }))._unsafeUnwrap();
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const last = first.items.at(-1)!;
    const second = (
      await tasks.list({
        ownerId: owner,
        limit: 2,
        after: { createdAt: last.createdAt, id: last.id },
      })
    )._unsafeUnwrap();
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);

    const seen = [...first.items, ...second.items].map((t) => t.id);
    expect(new Set(seen).size).toBe(3);
    expect(seen.sort()).toEqual([...mine].sort());
  });

  test("update は status を反映し updatedAt を進める。他人のタスク・存在しないタスクは NotFound で変えない", async () => {
    const { tasks, seedOwner } = make();
    const owner = await seedOwner();
    const other = await seedOwner();
    const task = await createTask(tasks, owner);

    const updated = (await tasks.update({ ...task, status: "done" }))._unsafeUnwrap();
    expect(updated.status).toBe("done");
    expect(updated.ownerId).toBe(owner);
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(task.updatedAt.getTime());
    expect((await tasks.getById(task.id, owner))._unsafeUnwrap()?.status).toBe("done");

    // 所有者を偽った update は他人のタスクを上書きしない
    const hijack = await tasks.update({ ...task, ownerId: other, status: "in_progress" });
    expect(hijack._unsafeUnwrapErr()).toBe("NotFound");
    const after = (await tasks.getById(task.id, owner))._unsafeUnwrap();
    expect(after?.status).toBe("done");
    expect(after?.ownerId).toBe(owner);

    const missing = await tasks.update({ ...task, id: crypto.randomUUID() as TaskId });
    expect(missing._unsafeUnwrapErr()).toBe("NotFound");
  });

  test("delete は所有者だけが消せる。他人・存在しない・消した後は NotFound", async () => {
    const { tasks, seedOwner } = make();
    const owner = await seedOwner();
    const other = await seedOwner();
    const task = await createTask(tasks, owner);

    expect((await tasks.delete(task.id, other))._unsafeUnwrapErr()).toBe("NotFound");
    expect((await tasks.getById(task.id, owner))._unsafeUnwrap()?.id).toBe(task.id);

    expect((await tasks.delete(task.id, owner)).isOk()).toBe(true);
    expect((await tasks.getById(task.id, owner))._unsafeUnwrap()).toBeNull();
    expect((await tasks.delete(task.id, owner))._unsafeUnwrapErr()).toBe("NotFound");
  });
});

describe.each(implementations)("ActivityRepository の適合: $name", ({ make }) => {
  test("record は渡した値で記録し、list は所有者で絞る", async () => {
    const { activity, seedOwner } = make();
    const owner = await seedOwner();
    const other = await seedOwner();
    const message = `created ${crypto.randomUUID()}`;

    const recorded = (
      await activity.record({ ownerId: owner, kind: "task_created", message })
    )._unsafeUnwrap();
    expect(recorded).toMatchObject({ ownerId: owner, kind: "task_created", message });
    await activity.record({ ownerId: other, kind: "task_created", message: "theirs" });

    const listed = (await activity.list({ ownerId: owner }))._unsafeUnwrap().items;
    expect(listed.map((a) => a.id)).toEqual([recorded.id]);
  });

  test("list は最大 50 件で打ち切る", async () => {
    const { activity, seedOwner } = make();
    const owner = await seedOwner();
    for (let i = 0; i < 51; i++) {
      await activity.record({ ownerId: owner, kind: "task_created", message: `m${i}` });
    }
    const listed = (await activity.list({ ownerId: owner }))._unsafeUnwrap().items;
    expect(listed).toHaveLength(50);
  });
});
