import { describe, expect, test } from "bun:test";

import { errAsync, okAsync } from "neverthrow";

import type { AuthUser } from "../../domain/models";
import { makeGetSession } from "./usecase";

const mockUser: AuthUser = {
  id: "user-1" as AuthUser["id"],
  email: "test@example.com",
  name: "Test User",
};

describe("auth.getSession usecase", () => {
  test("正常: 有効なセッションで AuthUser と Set-Cookie を返す", async () => {
    const setCookieHeaders = ["better-auth.session_token=abc; Max-Age=604800"];
    const verifySession = () => okAsync({ user: mockUser, setCookieHeaders });
    const getSession = makeGetSession({ verifySession });

    const r = await getSession(new Request("http://localhost"));
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.user.email).toBe("test@example.com");
      expect(r.value.user.name).toBe("Test User");
      expect(r.value.setCookieHeaders).toEqual(setCookieHeaders);
    }
  });

  test("異常: 未認証の場合 Unauthorized を返す", async () => {
    const verifySession = () => errAsync("Unauthorized" as const);
    const getSession = makeGetSession({ verifySession });

    const r = await getSession(new Request("http://localhost"));
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Unauthorized");
    }
  });

  test("異常: 予期しないエラーの場合 Unexpected を返す", async () => {
    const verifySession = () => errAsync("Unexpected" as const);
    const getSession = makeGetSession({ verifySession });

    const r = await getSession(new Request("http://localhost"));
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error).toBe("Unexpected");
    }
  });
});
