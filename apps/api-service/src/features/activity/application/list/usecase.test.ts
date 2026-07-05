import { describe, expect, test } from "bun:test";

import { errAsync, okAsync } from "neverthrow";

import type { ActivityRepository } from "../../domain/activity.repository";
import { reconstituteActivity } from "../../domain/models";
import { makeListActivities } from "./usecase";

const OWNER_ID = "user-1";

describe("activity.list usecase", () => {
  test("正常: 活動ログの一覧を返し、ownerId をリポジトリに渡す", async () => {
    let receivedOwnerId: string | undefined;
    const activityRepository: ActivityRepository = {
      record: () =>
        okAsync(
          reconstituteActivity({
            id: "1",
            ownerId: OWNER_ID,
            kind: "x",
            message: "m",
            occurredAt: new Date(),
          }),
        ),
      list: (input) => {
        receivedOwnerId = input.ownerId;
        return okAsync({
          items: [
            reconstituteActivity({
              id: "1",
              ownerId: OWNER_ID,
              kind: "task_created",
              message: "m",
              occurredAt: new Date(),
            }),
          ],
        });
      },
    };
    const usecase = makeListActivities({ activityRepository });
    const r = await usecase({ ownerId: OWNER_ID });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.items).toHaveLength(1);
    }
    expect(receivedOwnerId).toBe(OWNER_ID);
  });

  test("異常: リポジトリが失敗した場合 Unexpected を返す", async () => {
    const activityRepository: ActivityRepository = {
      record: () => errAsync("Unexpected" as const),
      list: () => errAsync("Unexpected" as const),
    };
    const usecase = makeListActivities({ activityRepository });
    const r = await usecase({ ownerId: OWNER_ID });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Unexpected");
    }
  });
});
