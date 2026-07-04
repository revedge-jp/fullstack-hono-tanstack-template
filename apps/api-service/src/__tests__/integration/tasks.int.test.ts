import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { makeTaskTitle } from "@app/features/tasks/domain/models";
import { createTasksRepository } from "@app/features/tasks/infrastructure/tasks.repository.drizzle";
import { authUsers, createDb } from "@repo/db";
import { eq } from "drizzle-orm";

const { db, end } = createDb(process.env.DATABASE_URL ?? "");
const tasksRepository = createTasksRepository({ db });

const OWNER_ID = `int-test-owner-${crypto.randomUUID()}`;

function title(value: string) {
  const result = makeTaskTitle(value);
  if (result.isErr()) {
    throw new Error("invalid test fixture title");
  }
  return result.value;
}

beforeAll(async () => {
  await db.insert(authUsers).values({
    id: OWNER_ID,
    name: "Integration Test User",
    email: `${OWNER_ID}@example.com`,
  });
});

afterAll(async () => {
  await db.delete(authUsers).where(eq(authUsers.id, OWNER_ID));
  await end();
});

describe("TasksRepository (実DB)", () => {
  test("create → list → getById → update → delete の往復", async () => {
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
    const result = await tasksRepository.getById(crypto.randomUUID(), OWNER_ID);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeNull();
    }
  });

  test("keyset ページネーション: limit 件ずつ取得し、重複も欠落もなく全件を辿れる", async () => {
    const pgOwner = `int-test-pagination-${crypto.randomUUID()}`;
    await db.insert(authUsers).values({
      id: pgOwner,
      name: "Pagination Test User",
      email: `${pgOwner}@example.com`,
    });

    const createdIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const created = await tasksRepository.create({
        ownerId: pgOwner,
        title: title(`Page task ${i} ${crypto.randomUUID()}`),
      });
      expect(created.isOk()).toBe(true);
      if (created.isOk()) {
        createdIds.push(created.value.id);
      }
    }

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

    // 5件を limit=2 で辿ると 3 ページ、重複・欠落なし
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
    expect(seen.sort()).toEqual([...createdIds].sort());

    await db.delete(authUsers).where(eq(authUsers.id, pgOwner));
  });

  test("所有者が異なる delete は NotFound を返す", async () => {
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
