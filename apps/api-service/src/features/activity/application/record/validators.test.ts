import { describe, expect, test } from "bun:test";

import { validateRecordActivity } from "./validators";

describe("validateRecordActivity", () => {
  test("正常: kind と message が両方非空なら Ok を返す", () => {
    const r = validateRecordActivity({ kind: "task_created", message: "Task created" });
    expect(r.isOk()).toBe(true);
  });

  test("異常: kind が空文字の場合 Invalid を返す", () => {
    const r = validateRecordActivity({ kind: "", message: "Task created" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Invalid");
    }
  });

  test("異常: kind が空白のみの場合 Invalid を返す", () => {
    const r = validateRecordActivity({ kind: "   ", message: "Task created" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Invalid");
    }
  });

  test("異常: message が空文字の場合 Invalid を返す", () => {
    const r = validateRecordActivity({ kind: "task_created", message: "" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Invalid");
    }
  });

  test("異常: message が空白のみの場合 Invalid を返す", () => {
    const r = validateRecordActivity({ kind: "task_created", message: "   " });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Invalid");
    }
  });
});
