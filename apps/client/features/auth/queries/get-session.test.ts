import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { SessionUser } from "@/shared/lib/api-client";

const mockUser: SessionUser = { id: "u1", email: "a@example.com", name: "A" };

let mockMeOk = true;
let lastHeaders: Record<string, string> | undefined;

mock.module("@/shared/lib/api-client", () => ({
  getApiClient: () => ({
    api: {
      me: {
        $get: mock((_args: unknown, opts?: { init?: { headers?: Record<string, string> } }) => {
          lastHeaders = opts?.init?.headers;
          return Promise.resolve({
            ok: mockMeOk,
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
    lastHeaders = undefined;
  });

  test("API が ok=true を返す場合は SessionUser を返し、cookie を転送する", async () => {
    const result = await getSessionServerFn();
    expect(result).toEqual(mockUser);
    expect(lastHeaders).toEqual({ cookie: "session=test" });
  });

  test("API が ok でない場合は null を返す", async () => {
    mockMeOk = false;
    const result = await getSessionServerFn();
    expect(result).toBeNull();
  });
});
