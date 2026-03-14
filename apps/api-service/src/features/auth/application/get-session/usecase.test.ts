import { describe, expect, test } from "bun:test";
import { err, ok } from "@repo/result";
import type { AuthUser } from "../../domain/models";
import { makeGetSession } from "./usecase";

const mockUser: AuthUser = {
  id: "user-1" as AuthUser["id"],
  email: "test@example.com",
  name: "Test User",
};

describe("auth.getSession usecase", () => {
  test("正常: 有効なセッションで AuthUser を返す", async () => {
    const verifySession = async () => ok(mockUser);
    const getSession = makeGetSession({ verifySession });

    const r = await getSession(new Request("http://localhost"));
    expect(r.type).toBe("ok");
    if (r.type === "ok") {
      expect(r.value.email).toBe("test@example.com");
      expect(r.value.name).toBe("Test User");
    }
  });

  test("異常: 未認証の場合 Unauthorized を返す", async () => {
    const verifySession = async () => err("Unauthorized" as const);
    const getSession = makeGetSession({ verifySession });

    const r = await getSession(new Request("http://localhost"));
    expect(r.type).toBe("err");
    if (r.type === "err") {
      expect(r.value).toBe("Unauthorized");
    }
  });

  test("異常: 予期しないエラーの場合 Unexpected を返す", async () => {
    const verifySession = async () => err("Unexpected" as const);
    const getSession = makeGetSession({ verifySession });

    const r = await getSession(new Request("http://localhost"));
    expect(r.type).toBe("err");
    if (r.type === "err") {
      expect(r.value).toBe("Unexpected");
    }
  });
});
