import { describe, expect, test } from "bun:test";

import type { ActivityService } from "@app/features/activity/application/service";
import { errAsync, okAsync } from "neverthrow";

import { createActivityRecorder } from "./activity-recorder";

// feature 間連携アダプタの参照実装。ポートの契約（入力の組み立てと
// エラー型の正規化）を検証する。activity feature の中身には踏み込まない。
function createFakeActivityService(overrides: Partial<ActivityService> = {}): ActivityService {
  return {
    recordActivity: () => okAsync({ item: { id: "activity-1" } }),
    listActivities: () => okAsync({ items: [] }),
    ...overrides,
  };
}

describe("createActivityRecorder", () => {
  test("正常: task_created の記録を activity service に委譲し、void に変換する", async () => {
    const calls: Parameters<ActivityService["recordActivity"]>[0][] = [];
    const activity = createFakeActivityService({
      recordActivity: (input) => {
        calls.push(input);
        return okAsync({ item: { id: "activity-1" } });
      },
    });
    const recorder = createActivityRecorder({ activity });

    const result = await recorder.recordTaskCreated({
      id: "task-1",
      title: "Buy milk",
      ownerId: "user-1",
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeUndefined();
    }
    expect(calls).toEqual([
      {
        ownerId: "user-1",
        kind: "task_created",
        message: 'Task "Buy milk" (task-1) created',
      },
    ]);
  });

  test("異常: recordActivity の Invalid はポートのエラー型 Unexpected に正規化される", async () => {
    const activity = createFakeActivityService({
      recordActivity: () => errAsync("Invalid" as const),
    });
    const recorder = createActivityRecorder({ activity });

    const result = await recorder.recordTaskCreated({
      id: "task-1",
      title: "Buy milk",
      ownerId: "user-1",
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBe("Unexpected");
    }
  });

  test("異常: recordActivity の Unexpected はそのまま Unexpected を返す", async () => {
    const activity = createFakeActivityService({
      recordActivity: () => errAsync("Unexpected" as const),
    });
    const recorder = createActivityRecorder({ activity });

    const result = await recorder.recordTaskCreated({
      id: "task-1",
      title: "Buy milk",
      ownerId: "user-1",
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBe("Unexpected");
    }
  });
});
