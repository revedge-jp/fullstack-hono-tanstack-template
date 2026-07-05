import { describe, expect, test } from "bun:test";

import { errAsync, okAsync } from "neverthrow";

import type { ActivityRepository } from "../../domain/activity.repository";
import { reconstituteActivity } from "../../domain/models";
import { makeRecordActivity } from "./usecase";

const ID_1 = "activity-1";
const OWNER_ID = "user-1";

describe("activity.record usecase", () => {
  test("正常: 有効な入力で活動ログを記録する", async () => {
    const activityRepository: ActivityRepository = {
      record: () =>
        okAsync(
          reconstituteActivity({
            id: ID_1,
            ownerId: OWNER_ID,
            kind: "task_created",
            message: "Task created",
            occurredAt: new Date(),
          }),
        ),
      list: () => okAsync({ items: [] }),
    };
    const usecase = makeRecordActivity({ activityRepository });
    const r = await usecase({ ownerId: OWNER_ID, kind: "task_created", message: "Task created" });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.item.id).toBe(ID_1);
    }
  });

  test("異常: kind が空の場合 Invalid を返す", async () => {
    const activityRepository = {} as ActivityRepository;
    const usecase = makeRecordActivity({ activityRepository });
    const r = await usecase({ ownerId: OWNER_ID, kind: "", message: "Task created" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Invalid");
    }
  });

  test("異常: ownerId が空の場合 Invalid を返す", async () => {
    const activityRepository = {} as ActivityRepository;
    const usecase = makeRecordActivity({ activityRepository });
    const r = await usecase({ ownerId: "", kind: "task_created", message: "Task created" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Invalid");
    }
  });

  test("異常: リポジトリが失敗した場合 Unexpected を返す", async () => {
    const activityRepository: ActivityRepository = {
      record: () => errAsync("Unexpected" as const),
      list: () => okAsync({ items: [] }),
    };
    const usecase = makeRecordActivity({ activityRepository });
    const r = await usecase({ ownerId: OWNER_ID, kind: "task_created", message: "Task created" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Unexpected");
    }
  });
});
