import { describe, expect, test } from "bun:test";
import { err } from "@repo/result";
import { validateUpdateUser } from "./validators";

const ID_1 = "550e8400-e29b-41d4-a716-446655440001";

describe("users.application validateUpdateUser", () => {
  test("正常: 有効なペイロードを受け入れる", () => {
    const r = validateUpdateUser({ id: ID_1, name: "Alice" });
    expect(r.type).toBe("ok");
    if (r.type === "ok") {
      expect(r.value.name as string).toBe("Alice");
    }
  });

  test("正常: 名前が null を受け入れる", () => {
    const r = validateUpdateUser({ id: ID_1, name: null });
    expect(r.type).toBe("ok");
    if (r.type === "ok") {
      expect(r.value.name).toBe(null);
    }
  });

  test("異常: トリム後に空になる名前で Invalid を返す", () => {
    const r = validateUpdateUser({ id: ID_1, name: "   " });
    expect(r).toEqual(err("Invalid"));
  });

  test("異常: 空文字の名前で Invalid を返す", () => {
    const r = validateUpdateUser({ id: ID_1, name: "" });
    expect(r).toEqual(err("Invalid"));
  });
});
