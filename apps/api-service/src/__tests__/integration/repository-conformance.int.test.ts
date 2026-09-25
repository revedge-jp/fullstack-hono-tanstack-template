import { afterAll, describe, expect, test } from "bun:test";

import type { ActivityRepository } from "@app/features/activity/domain/activity.repository";
import { type Activity, reconstituteActivity } from "@app/features/activity/domain/models";
import { createActivityRepository } from "@app/features/activity/infrastructure/activity.repository.drizzle";
import { mapDbActivityToDomain } from "@app/features/activity/infrastructure/mappers";
import {
  makeTaskTitle,
  reconstituteTask,
  type Task,
  type TaskId,
} from "@app/features/tasks/domain/models";
import type { TasksRepository } from "@app/features/tasks/domain/tasks.repository";
import { mapDbTaskToDomain } from "@app/features/tasks/infrastructure/mappers";
import { createTasksRepository } from "@app/features/tasks/infrastructure/tasks.repository.drizzle";
import {
  createInMemoryActivityRepository,
  createInMemoryTasksRepository,
} from "@app/test-helpers/in-memory-repositories";
import { createTransactionalDb } from "@app/test-helpers/transactional-db";
import { activities, authUsers, type Database, tasks as tasksTable } from "@repo/db";

// fake↔real 適合テスト。createFakeApp の in-memory リポジトリ（contract テスト等が使う）と Drizzle
// 実装に同じテストを流し、挙動のずれを検出する。ずれていると contract テストは緑のまま、本番だけ
// 別の挙動になる。**Drizzle 実装が正**。落ちたら in-memory 側を直す。
//
// **時刻に依存する性質（並び順・ページ送り・updatedAt）は、時刻を明示してシードして検証する**
// （seedTasks / seedActivities）。create / record の既定時刻に任せると、Drizzle 側は1テスト内の行が
// 同じトランザクションの now() で同時刻になり、時刻での比較が一度も通らないまま緑になる
// （in-memory 側の並びを逆にしても検出できなかった）。
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
  // 時刻を明示して行を入れ、その行が見える（= harness の tasks / activity と同じ）リポジトリを返す
  seedTasks: (
    ownerId: string,
    createdAts: Date[],
  ) => Promise<{ tasks: TasksRepository; seeded: Task[] }>;
  seedActivities: (
    ownerId: string,
    occurredAts: Date[],
  ) => Promise<{ activity: ActivityRepository; seeded: Activity[] }>;
};

const BASE = Date.UTC(2026, 0, 1);

function seedTitle(i: number) {
  return title(`seeded ${i} ${crypto.randomUUID()}`);
}

const implementations: { name: string; make: () => Harness }[] = [
  {
    name: "in-memory（createFakeApp）",
    make: () => {
      // シードもリポジトリ自身の操作も同じ保存先に入れる。Drizzle 側は同じトランザクションの全行が
      // 見えるので、シードのたびにリポジトリを作り直すと両側で見える行が食い違う
      const taskStore = new Map<string, Task>();
      const activityStore: Activity[] = [];
      const tasks = createInMemoryTasksRepository([], taskStore);
      const activity = createInMemoryActivityRepository([], activityStore);
      return {
        tasks,
        activity,
        seedOwner: async () => `conformance-owner-${crypto.randomUUID()}`,
        seedTasks: async (ownerId, createdAts) => {
          const seeded = createdAts.map((createdAt, i) =>
            reconstituteTask({
              id: crypto.randomUUID(),
              ownerId,
              title: seedTitle(i),
              status: "todo",
              createdAt,
              updatedAt: createdAt,
            }),
          );
          for (const t of seeded) {
            taskStore.set(t.id, t);
          }
          return { tasks, seeded };
        },
        seedActivities: async (ownerId, occurredAts) => {
          const seeded = occurredAts.map((occurredAt, i) =>
            reconstituteActivity({
              id: crypto.randomUUID(),
              ownerId,
              kind: "task_created",
              message: `seeded ${i}`,
              occurredAt,
            }),
          );
          activityStore.push(...seeded);
          return { activity, seeded };
        },
      };
    },
  },
  {
    name: "drizzle（実DB）",
    make: () => {
      const db = getDb();
      const tasks = createTasksRepository({ db });
      const activity = createActivityRepository({ db });
      return {
        tasks,
        activity,
        seedOwner: async () => {
          const id = `conformance-owner-${crypto.randomUUID()}`;
          await db
            .insert(authUsers)
            .values({ id, name: "Conformance", email: `${id}@example.com` });
          return id;
        },
        seedTasks: async (ownerId, createdAts) => {
          const rows = await db
            .insert(tasksTable)
            .values(
              createdAts.map((createdAt, i) => ({
                ownerId,
                title: seedTitle(i),
                createdAt,
                updatedAt: createdAt,
              })),
            )
            .returning();
          return { tasks, seeded: rows.map(mapDbTaskToDomain) };
        },
        seedActivities: async (ownerId, occurredAts) => {
          const rows = await db
            .insert(activities)
            .values(
              occurredAts.map((occurredAt, i) => ({
                ownerId,
                kind: "task_created",
                message: `seeded ${i}`,
                occurredAt,
              })),
            )
            .returning();
          return { activity, seeded: rows.map(mapDbActivityToDomain) };
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

    const updated = (
      await tasks.update({ ...task, status: "done" }, { status: "todo" })
    )._unsafeUnwrap();
    expect(updated.status).toBe("done");
    expect(updated.ownerId).toBe(owner);
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(task.updatedAt.getTime());
    expect((await tasks.getById(task.id, owner))._unsafeUnwrap()?.status).toBe("done");

    // 所有者を偽った update は他人のタスクを上書きしない
    const hijack = await tasks.update(
      { ...task, ownerId: other, status: "in_progress" },
      { status: "done" },
    );
    expect(hijack._unsafeUnwrapErr()).toBe("NotFound");
    const after = (await tasks.getById(task.id, owner))._unsafeUnwrap();
    expect(after?.status).toBe("done");
    expect(after?.ownerId).toBe(owner);

    const missing = await tasks.update(
      { ...task, id: crypto.randomUUID() as TaskId },
      { status: "todo" },
    );
    expect(missing._unsafeUnwrapErr()).toBe("NotFound");
  });

  // 楽観ロック: 読んだ後に他のリクエストが status を変えていたら、古い読み取りで上書きしない
  // （done のタスクが in_progress に巻き戻る競合を防ぐ）
  test("update は expected の status と食い違えば Conflict で、行を変えない", async () => {
    const { tasks, seedOwner } = make();
    const owner = await seedOwner();
    const task = await createTask(tasks, owner);
    (await tasks.update({ ...task, status: "in_progress" }, { status: "todo" }))._unsafeUnwrap();
    (await tasks.update({ ...task, status: "done" }, { status: "in_progress" }))._unsafeUnwrap();

    // todo を読んだ古いリクエストが in_progress へ進めようとする
    const stale = await tasks.update({ ...task, status: "in_progress" }, { status: "todo" });
    expect(stale._unsafeUnwrapErr()).toBe("Conflict");
    expect((await tasks.getById(task.id, owner))._unsafeUnwrap()?.status).toBe("done");
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

  test("list は (createdAt, id) の降順で、時刻をまたぐページ境界と同着の境界の両方を正しく辿る", async () => {
    const { seedOwner, seedTasks } = make();
    const owner = await seedOwner();
    const other = await seedOwner();
    // 時刻がすべて別の行と、同着の組（2000ms が2件）の両方を入れる。limit 2 で辿ると、
    // 1→2 ページ目の境界で同着の比較（id）、2→3 ページ目の境界で時刻の比較が効く
    const { tasks, seeded } = await seedTasks(
      owner,
      [0, 1000, 2000, 2000, 3000].map((offset) => new Date(BASE + offset)),
    );
    await seedTasks(other, [new Date(BASE + 5000)]);
    const expected = [...seeded]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .map((t) => t.id);

    const seen: string[] = [];
    let after: { createdAt: Date; id: string } | undefined;
    let pages = 0;
    for (;;) {
      const page = (await tasks.list({ ownerId: owner, limit: 2, after }))._unsafeUnwrap();
      seen.push(...page.items.map((t) => t.id));
      pages += 1;
      if (!page.hasMore || pages > 5) {
        break;
      }
      const last = page.items.at(-1)!;
      after = { createdAt: last.createdAt, id: last.id };
    }
    expect(pages).toBe(3);
    expect(seen).toEqual(expected);
  });

  test("update は updatedAt を更新時刻へ進め、status 以外（title 等）は変えない", async () => {
    const { seedOwner, seedTasks } = make();
    const owner = await seedOwner();
    const { tasks, seeded } = await seedTasks(owner, [new Date(BASE)]);
    const original = seeded[0]!;

    const updated = (
      await tasks.update(
        { ...original, status: "in_progress", title: title("renamed") },
        { status: "todo" },
      )
    )._unsafeUnwrap();
    expect(updated.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());
    expect(updated.title).toBe(original.title);
    expect((await tasks.getById(original.id, owner))._unsafeUnwrap()?.title).toBe(original.title);
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

  test("list は occurredAt の降順で、最新の 50 件だけを返す", async () => {
    const { seedOwner, seedActivities } = make();
    const owner = await seedOwner();
    const { activity, seeded } = await seedActivities(
      owner,
      Array.from({ length: 51 }, (_, i) => new Date(BASE + i * 1000)),
    );
    const expected = [...seeded]
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, 50)
      .map((a) => a.id);

    const listed = (await activity.list({ ownerId: owner }))._unsafeUnwrap().items;
    expect(listed.map((a) => a.id)).toEqual(expected);
  });
});
