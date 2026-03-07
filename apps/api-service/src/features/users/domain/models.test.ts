import { describe, expect, test } from "bun:test";
import { isOk } from "@repo/result";
import {
  changeUserName,
  type Email,
  makeEmail,
  makeUserName,
  reconstituteUser,
  type UserName,
} from "./models";

describe("User Domain Models", () => {
  describe("Email", () => {
    test("正常: 有効なメールアドレスを受け入れる", () => {
      const result = makeEmail("test@example.com");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const email: Email = result.value;
        expect(email as string).toBe("test@example.com");
      }
    });

    test("異常: 不正なメールアドレスを拒否する", () => {
      const result = makeEmail("invalid-email");
      expect(isOk(result)).toBe(false);
    });

    test("正常: 前後の空白をトリムする", () => {
      const result = makeEmail("  test@example.com  ");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value as string).toBe("test@example.com");
      }
    });
  });

  describe("UserName", () => {
    test("正常: 有効なユーザー名を受け入れる", () => {
      const result = makeUserName("Alice");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const name: UserName | null = result.value;
        expect(name as string).toBe("Alice");
      }
    });

    test("正常: null を受け入れる", () => {
      const result = makeUserName(null);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(null);
      }
    });

    test("異常: 空文字を拒否する", () => {
      const result = makeUserName("");
      expect(isOk(result)).toBe(false);
    });

    test("異常: 100文字超えの名前を拒否する", () => {
      const longName = "a".repeat(101);
      const result = makeUserName(longName);
      expect(isOk(result)).toBe(false);
    });
  });

  const ID_1 = "550e8400-e29b-41d4-a716-446655440001";

  describe("User.changeUserName", () => {
    test("正常: 名前を正常に更新する", () => {
      const user = reconstituteUser({
        id: ID_1,
        email: "a@example.com",
        name: "Alice",
      });
      const result = changeUserName(user, "Bob");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(String(result.value.name)).toBe("Bob");
        expect(result.value.id).toBe(ID_1);
      }
    });

    test("正常: 名前を null に更新する", () => {
      const user = reconstituteUser({
        id: ID_1,
        email: "a@example.com",
        name: "Alice",
      });
      const result = changeUserName(user, null);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.name).toBeNull();
      }
    });

    test("異常: 不正な名前を拒否する", () => {
      const user = reconstituteUser({
        id: ID_1,
        email: "a@example.com",
        name: "Alice",
      });
      const result = changeUserName(user, "");
      expect(isOk(result)).toBe(false);
    });
  });
});
