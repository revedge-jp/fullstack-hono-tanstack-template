import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createActivityRepository } from "@app/features/activity/infrastructure/activity.repository.drizzle";
import { authUsers, createDb } from "@repo/db";
import { inArray } from "drizzle-orm";

const { db, end } = createDb(process.env.DATABASE_URL ?? "");
const activityRepository = createActivityRepository({ db });

const OWNER_A = `int-test-activity-a-${crypto.randomUUID()}`;
const OWNER_B = `int-test-activity-b-${crypto.randomUUID()}`;

beforeAll(async () => {
  await db.insert(authUsers).values([
    { id: OWNER_A, name: "Activity User A", email: `${OWNER_A}@example.com` },
    { id: OWNER_B, name: "Activity User B", email: `${OWNER_B}@example.com` },
  ]);
});

afterAll(async () => {
  // activities は owner_id の FK cascade で消える
  await db.delete(authUsers).where(inArray(authUsers.id, [OWNER_A, OWNER_B]));
  await end();
});

describe("ActivityRepository (実DB)", () => {
  test("record → list の往復で ownerId が保存される", async () => {
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
