import { describe, expect, test } from "bun:test";

import { validateRecordActivity } from "./validators";

const VALID = { ownerId: "user-1", kind: "task_created", message: "Task created" };

describe("validateRecordActivity", () => {
  test("正常: ownerId / kind / message がすべて非空なら Ok を返す", () => {
    const r = validateRecordActivity(VALID);
    expect(r.isOk()).toBe(true);
  });

  test("異常: kind が空文字の場合 Invalid を返す", () => {
    const r = validateRecordActivity({ ...VALID, kind: "" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Invalid");
    }
  });

  test("異常: kind が空白のみの場合 Invalid を返す", () => {
    const r = validateRecordActivity({ ...VALID, kind: "   " });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Invalid");
    }
  });

  test("異常: message が空文字の場合 Invalid を返す", () => {
    const r = validateRecordActivity({ ...VALID, message: "" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Invalid");
    }
  });

  test("異常: message が空白のみの場合 Invalid を返す", () => {
    const r = validateRecordActivity({ ...VALID, message: "   " });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Invalid");
    }
  });

  test("異常: ownerId が空文字の場合 Invalid を返す", () => {
    const r = validateRecordActivity({ ...VALID, ownerId: "" });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Invalid");
    }
  });

  test("異常: ownerId が空白のみの場合 Invalid を返す", () => {
    const r = validateRecordActivity({ ...VALID, ownerId: "   " });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Invalid");
    }
  });
});
