import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { SessionUser } from "@/shared/lib/api-client";

const mockUser: SessionUser = { id: "u1", email: "a@example.com", name: "A" };

let mockMeOk = true;
let mockStatus = 200;
let lastHeaders: Record<string, string> | undefined;

mock.module("@/shared/lib/api-client", () => ({
  getApiClient: () => ({
    api: {
      me: {
        $get: mock((_args: unknown, opts?: { init?: { headers?: Record<string, string> } }) => {
          lastHeaders = opts?.init?.headers;
          return Promise.resolve({
            ok: mockMeOk,
            status: mockStatus,
            json: async () =>
              mockMeOk ? { ok: true, data: mockUser } : { ok: false, error: "Unauthorized" },
          });
        }),
      },
    },
  }),
}));

mock.module("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (fn: () => unknown) => fn,
  }),
}));

mock.module("@tanstack/react-start/server", () => ({
  getRequest: () =>
    new Request("http://localhost/", {
      headers: { cookie: "session=test" },
    }),
}));

const { getSessionServerFn } = await import("./get-session");

describe("auth.getSessionServerFn", () => {
  beforeEach(() => {
    mockMeOk = true;
    mockStatus = 200;
    lastHeaders = undefined;
  });

  test("API が ok=true を返す場合は SessionUser を返し、cookie を転送する", async () => {
    const result = await getSessionServerFn();
    expect(result).toEqual(mockUser);
    expect(lastHeaders).toEqual({ cookie: "session=test" });
  });

  test("401（未認証）の場合は null を返す（リダイレクトは _authenticated ガードが担う）", async () => {
    mockMeOk = false;
    mockStatus = 401;
    const result = await getSessionServerFn();
    expect(result).toBeNull();
  });

  test("403（未認可）の場合も null を返す", async () => {
    mockMeOk = false;
    mockStatus = 403;
    const result = await getSessionServerFn();
    expect(result).toBeNull();
  });

  test("異常: 500（バックエンド障害）は throw する（未認証と区別してエラーバウンダリへ）", async () => {
    mockMeOk = false;
    mockStatus = 500;
    await expect(getSessionServerFn()).rejects.toThrow("セッションの取得に失敗しました");
  });
});
