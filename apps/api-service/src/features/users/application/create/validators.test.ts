import { describe, expect, test } from "bun:test";
import { validateCreateUser } from "./validators";

describe("users.application validateCreateUser", () => {
  test("正常: 有効なペイロードを受け入れる", () => {
    const r = validateCreateUser({ email: "a@example.com", name: "Alice" });
    expect(r.type).toBe("ok");
    if (r.type === "ok") {
      expect(String(r.value.email)).toBe("a@example.com");
      expect(String(r.value.name)).toBe("Alice");
    }
  });

  test("正常: 名前が null を受け入れる", () => {
    const r = validateCreateUser({
      email: "a@example.com",
      name: null,
    });
    expect(r.type).toBe("ok");
    if (r.type === "ok") {
      expect(String(r.value.email)).toBe("a@example.com");
      expect(r.value.name).toBeNull();
    }
  });

  test("異常: 不正なメールアドレスで Invalid を返す", () => {
    const r = validateCreateUser({ email: "not-an-email", name: "Alice" });
    expect(r.type).toBe("err");
    if (r.type === "err") {
      expect(r.value).toBe("Invalid");
    }
  });

  test("異常: トリム後に空になる名前で Invalid を返す", () => {
    const r = validateCreateUser({ email: "a@example.com", name: "" });
    expect(r.type).toBe("err");
    if (r.type === "err") {
      expect(r.value).toBe("Invalid");
    }
  });

  test("異常: 空白のみの名前で Invalid を返す", () => {
    const r = validateCreateUser({ email: "a@example.com", name: "   " });
    expect(r.type).toBe("err");
    if (r.type === "err") {
      expect(r.value).toBe("Invalid");
    }
  });
});
