import { afterAll, describe, expect, test } from "bun:test";

import { createActivityRepository } from "@app/features/activity/infrastructure/activity.repository.drizzle";
import { createTransactionalDb } from "@app/test-helpers/transactional-db";
import { authUsers, type Database } from "@repo/db";

import { createLoggerSpy } from "../../test-helpers/create-logger-spy";

// 各テストは BEGIN → ROLLBACK で包まれる（test-helpers/transactional-db.ts）。
const { getDb: getTx, end } = createTransactionalDb(process.env.DATABASE_URL ?? "");

function getDb(): Database {
  return getTx()!;
}

async function seedOwners(db: Database): Promise<{ ownerA: string; ownerB: string }> {
  const ownerA = `int-test-activity-a-${crypto.randomUUID()}`;
  const ownerB = `int-test-activity-b-${crypto.randomUUID()}`;
  await db.insert(authUsers).values([
    { id: ownerA, name: "Activity User A", email: `${ownerA}@example.com` },
    { id: ownerB, name: "Activity User B", email: `${ownerB}@example.com` },
  ]);
  return { ownerA, ownerB };
}

afterAll(async () => {
  await end();
});

describe("ActivityRepository (実DB)", () => {
  test("record → list の往復で ownerId が保存される", async () => {
    const db = getDb();
    const activityRepository = createActivityRepository({ db, logger: createLoggerSpy().logger });
    const { ownerA: OWNER_A } = await seedOwners(db);
    const recorded = await activityRepository.record({
      ownerId: OWNER_A,
      kind: "task_created",
      message: `Task "A" created ${crypto.randomUUID()}`,
    });
    expect(recorded.isOk()).toBe(true);
    if (recorded.isOk()) {
      expect(recorded.value.ownerId).toBe(OWNER_A);
    }

    const listed = await activityRepository.list({ ownerId: OWNER_A });
    expect(listed.isOk()).toBe(true);
    if (listed.isOk()) {
      expect(listed.value.items.length).toBeGreaterThanOrEqual(1);
      expect(listed.value.items.every((a) => a.ownerId === OWNER_A)).toBe(true);
    }
  });

  test("他ユーザーの activity は list に含まれない（オーナー分離）", async () => {
    const db = getDb();
    const activityRepository = createActivityRepository({ db, logger: createLoggerSpy().logger });
    const { ownerA: OWNER_A, ownerB: OWNER_B } = await seedOwners(db);
    const messageA = `Task "only-a" created ${crypto.randomUUID()}`;
    const recordedA = await activityRepository.record({
      ownerId: OWNER_A,
      kind: "task_created",
      message: messageA,
    });
    expect(recordedA.isOk()).toBe(true);

    const listedB = await activityRepository.list({ ownerId: OWNER_B });
    expect(listedB.isOk()).toBe(true);
    if (listedB.isOk()) {
      expect(listedB.value.items.some((a) => a.message === messageA)).toBe(false);
      expect(listedB.value.items.every((a) => a.ownerId === OWNER_B)).toBe(true);
    }
  });
});
