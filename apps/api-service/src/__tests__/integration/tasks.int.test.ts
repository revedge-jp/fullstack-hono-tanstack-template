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

    const listed = await tasksRepository.list({ ownerId: OWNER_ID });
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
