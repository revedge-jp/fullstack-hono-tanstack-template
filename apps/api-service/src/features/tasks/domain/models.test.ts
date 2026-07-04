import { describe, expect, test } from "bun:test";
import { advanceTaskStatus, makeTaskTitle, reconstituteTask, type TaskTitle } from "./models";

function buildTask(status: "todo" | "in_progress" | "done") {
  return reconstituteTask({
    id: "task-1",
    ownerId: "user-1",
    title: "Write docs",
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe("makeTaskTitle", () => {
  test("正常: 1〜200文字のタイトルを許可する", () => {
    const r = makeTaskTitle("Write docs");
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toBe("Write docs" as TaskTitle);
    }
  });

  test("正常: 前後の空白をトリムする", () => {
    const r = makeTaskTitle("  Write docs  ");
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toBe("Write docs" as TaskTitle);
    }
  });

  test("異常: 空文字は InvalidTitle を返す", () => {
    const r = makeTaskTitle("   ");
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("InvalidTitle");
    }
  });

  test("異常: 200文字を超えると InvalidTitle を返す", () => {
    const r = makeTaskTitle("a".repeat(201));
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("InvalidTitle");
    }
  });

  test("正常: 境界値 1文字を許可する", () => {
    const r = makeTaskTitle("a");
    expect(r.isOk()).toBe(true);
  });

  test("正常: 境界値 200文字ちょうどを許可する", () => {
    const r = makeTaskTitle("a".repeat(200));
    expect(r.isOk()).toBe(true);
  });
});

describe("advanceTaskStatus", () => {
  test("todo → in_progress へ進む", () => {
    const r = advanceTaskStatus(buildTask("todo"));
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.status).toBe("in_progress");
    }
  });

  test("in_progress → done へ進む", () => {
    const r = advanceTaskStatus(buildTask("in_progress"));
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.status).toBe("done");
    }
  });

  test("異常: done からは進められず AlreadyDone を返す", () => {
    const r = advanceTaskStatus(buildTask("done"));
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("AlreadyDone");
    }
  });
});
