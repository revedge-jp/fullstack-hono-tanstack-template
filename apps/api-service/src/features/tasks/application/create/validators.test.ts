import { describe, expect, test } from "bun:test";

import type { TaskTitle } from "../../domain/models";
import { validateCreateTask } from "./validators";

describe("validateCreateTask", () => {
  test("正常: ownerId と title を保持したまま返す", () => {
    const r = validateCreateTask({ ownerId: "user-1", title: "Write docs" });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.ownerId).toBe("user-1");
      expect(r.value.title).toBe("Write docs" as TaskTitle);
    }
  });

  test("異常: タイトルが空の場合 Invalid を返す", () => {
    const r = validateCreateTask({ ownerId: "user-1", title: "   " });
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Invalid");
    }
  });
});
