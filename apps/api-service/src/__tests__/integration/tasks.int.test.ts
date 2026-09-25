import { afterAll, describe, expect, test } from "bun:test";

import { makeTaskTitle } from "@app/features/tasks/domain/models";
import { createTasksRepository } from "@app/features/tasks/infrastructure/tasks.repository.drizzle";
import { createTransactionalDb } from "@app/test-helpers/transactional-db";
import { authUsers, type Database, tasks } from "@repo/db";

// 各テストは BEGIN → ROLLBACK で包まれる（test-helpers/transactional-db.ts）。
// テスト中に作ったユーザー・タスクは終了時に自動で消えるので、手書きの delete は書かない。
const { getDb: getTx, end } = createTransactionalDb(process.env.DATABASE_URL ?? "");

function getDb(): Database {
  return getTx()!;
}

async function seedOwner(db: Database, prefix = "int-test-owner"): Promise<string> {
  const id = `${prefix}-${crypto.randomUUID()}`;
  await db
    .insert(authUsers)
    .values({ id, name: "Integration Test User", email: `${id}@example.com` });
  return id;
}

function title(value: string) {
  const result = makeTaskTitle(value);
  if (result.isErr()) {
    throw new Error("invalid test fixture title");
  }
  return result.value;
}

afterAll(async () => {
  await end();
});

describe("TasksRepository (実DB)", () => {
  test("create → list → getById → update → delete の往復", async () => {
    const db = getDb();
    const tasksRepository = createTasksRepository({ db });
    const OWNER_ID = await seedOwner(db);
    const created = await tasksRepository.create({
      ownerId: OWNER_ID,
      title: title(`Write docs ${crypto.randomUUID()}`),
    });
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) {
      return;
    }

    const task = created.value;
    expect(task.status).toBe("todo");

    const listed = await tasksRepository.list({ ownerId: OWNER_ID, limit: 50 });
    expect(listed.isOk()).toBe(true);
    if (listed.isOk()) {
      expect(listed.value.items.some((t) => t.id === task.id)).toBe(true);
    }

    const fetched = await tasksRepository.getById(task.id, OWNER_ID);
    expect(fetched.isOk()).toBe(true);
    if (fetched.isOk()) {
      expect(fetched.value?.id).toBe(task.id);
    }

    const updated = await tasksRepository.update({ ...task, status: "in_progress" });
    expect(updated.isOk()).toBe(true);
    if (updated.isOk()) {
      expect(updated.value.status).toBe("in_progress");
    }

    const deleted = await tasksRepository.delete(task.id, OWNER_ID);
    expect(deleted.isOk()).toBe(true);

    const afterDelete = await tasksRepository.getById(task.id, OWNER_ID);
    expect(afterDelete.isOk()).toBe(true);
    if (afterDelete.isOk()) {
      expect(afterDelete.value).toBeNull();
    }
  });

  test("同一オーナー内でタイトルが重複すると Conflict を返す(一意制約)", async () => {
    const db = getDb();
    const tasksRepository = createTasksRepository({ db });
    const OWNER_ID = await seedOwner(db);
    const dupTitle = title(`Duplicate title ${crypto.randomUUID()}`);
    const first = await tasksRepository.create({ ownerId: OWNER_ID, title: dupTitle });
    expect(first.isOk()).toBe(true);

    const second = await tasksRepository.create({ ownerId: OWNER_ID, title: dupTitle });
    expect(second.isErr()).toBe(true);
    if (second.isErr()) {
      expect(second.error).toBe("Conflict");
    }
  });

  test("存在しないタスクの getById は null を返す(他ユーザーのタスクと区別しない)", async () => {
    const db = getDb();
    const tasksRepository = createTasksRepository({ db });
    const OWNER_ID = await seedOwner(db);
    const result = await tasksRepository.getById(crypto.randomUUID(), OWNER_ID);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeNull();
    }
  });

  // created_at は明示してシードする。1テスト内の行は同じトランザクションなので、defaultNow() に
  // 任せると全行が同時刻になり、カーソルの `lt(created_at)` 側がどの行にも効かず検証から抜ける
  // （同着タイブレークの `id` 側しか通らない）。時刻がすべて別の行と、同着の組の両方を入れる。
  test("keyset ページネーション: limit 件ずつ取得し、重複も欠落もなく (created_at, id) 降順で全件を辿れる", async () => {
    const db = getDb();
    const tasksRepository = createTasksRepository({ db });
    const pgOwner = await seedOwner(db, "int-test-pagination");

    const base = Date.UTC(2026, 0, 1);
    const offsetsMs = [0, 1000, 2000, 2000, 3000];
    const inserted = await db
      .insert(tasks)
      .values(
        offsetsMs.map((offset, i) => ({
          ownerId: pgOwner,
          title: `Page task ${i} ${crypto.randomUUID()}`,
          createdAt: new Date(base + offset),
        })),
      )
      .returning({ id: tasks.id, createdAt: tasks.createdAt });
    const expectedOrder = [...inserted]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .map((row) => row.id);

    const seen: string[] = [];
    let after: { createdAt: Date; id: string } | undefined;
    let pages = 0;
    while (pages < 10) {
      const page = await tasksRepository.list({ ownerId: pgOwner, limit: 2, after });
      expect(page.isOk()).toBe(true);
      if (!page.isOk()) {
        break;
      }
      seen.push(...page.value.items.map((t) => t.id));
      pages += 1;
      if (!page.value.hasMore) {
        break;
      }
      const last = page.value.items.at(-1);
      expect(last).toBeDefined();
      if (!last) {
        break;
      }
      after = { createdAt: last.createdAt, id: last.id };
    }

    // 5件を limit=2 で辿ると 3 ページ、重複・欠落なし、(created_at, id) 降順
    expect(pages).toBe(3);
    expect(seen).toEqual(expectedOrder);
  });

  test("所有者が異なる delete は NotFound を返す", async () => {
    const db = getDb();
    const tasksRepository = createTasksRepository({ db });
    const OWNER_ID = await seedOwner(db);
    const created = await tasksRepository.create({
      ownerId: OWNER_ID,
      title: title(`Not owned ${crypto.randomUUID()}`),
    });
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) {
      return;
    }

    const result = await tasksRepository.delete(created.value.id, "someone-else");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBe("NotFound");
    }
  });
});
