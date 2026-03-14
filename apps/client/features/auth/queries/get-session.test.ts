import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SessionUser } from "@/shared/lib/app-context";

const mockUser: SessionUser = { id: "u1", email: "a@example.com", name: "A" };

// getSessionChecker は各テストで上書きする
let mockChecker: ((headers: Headers) => Promise<SessionUser | null>) | undefined;

mock.module("@/shared/lib/app-context", () => ({
  getSessionChecker: () => mockChecker,
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

let mockMeOk = true;

mock.module("hono/client", () => ({
  hc: () => ({
    api: {
      me: {
        $get: mock(() =>
          Promise.resolve({
            ok: mockMeOk,
            json: async () =>
              mockMeOk ? { ok: true, data: mockUser } : { ok: false, error: "Unauthorized" },
          }),
        ),
      },
    },
  }),
}));

const { getSessionServerFn } = await import("./get-session");

describe("auth.getSessionServerFn", () => {
  beforeEach(() => {
    mockChecker = undefined;
    mockMeOk = true;
  });

  describe("CF Workers パス (checker あり)", () => {
    test("checker が SessionUser を返す場合はそのまま返す", async () => {
      mockChecker = async () => mockUser;
      const result = await getSessionServerFn();
      expect(result).toEqual(mockUser);
    });

    test("checker が null を返す場合は null を返す", async () => {
      mockChecker = async () => null;
      const result = await getSessionServerFn();
      expect(result).toBeNull();
    });
  });

  describe("ローカル dev フォールバック (checker なし)", () => {
    test("API が ok=true を返す場合は SessionUser を返す", async () => {
      mockMeOk = true;
      const result = await getSessionServerFn();
      expect(result).toEqual(mockUser);
    });

    test("API が ok でない場合は null を返す", async () => {
      mockMeOk = false;
      const result = await getSessionServerFn();
      expect(result).toBeNull();
    });
  });
});
