import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { SessionUser } from "@/shared/lib/api-client";
import { createApiMock, reactStartModule, reactStartServerModule } from "@/test-helpers/api-mock";

const mockUser: SessionUser = { id: "u1", email: "a@example.com", name: "A" };

const api = createApiMock({ body: { ok: true, data: mockUser } });
await mock.module("@/shared/lib/api-client", api.apiClientModule);
await mock.module("@tanstack/react-start", reactStartModule);
await mock.module("@tanstack/react-start/server", reactStartServerModule());

const { getSessionServerFn } = await import("./get-session");

describe("auth.getSessionServerFn", () => {
  beforeEach(() => api.reset());

  test("API が ok=true を返す場合は SessionUser を返し、cookie を転送する", async () => {
    const result = await getSessionServerFn();
    expect(result).toEqual(mockUser);
    expect(api.state.lastHeaders).toEqual({ cookie: "session=test" });
  });

  test("401（未認証）の場合は null を返す（リダイレクトは _authenticated ガードが担う）", async () => {
    api.reset({ ok: false, status: 401, body: { ok: false, error: "Unauthorized" } });
    const result = await getSessionServerFn();
    expect(result).toBeNull();
  });

  test("403（未認可）の場合も null を返す", async () => {
    api.reset({ ok: false, status: 403, body: { ok: false, error: "Unauthorized" } });
    const result = await getSessionServerFn();
    expect(result).toBeNull();
  });

  test("異常: 500（バックエンド障害）は throw する（未認証と区別してエラーバウンダリへ）", async () => {
    api.reset({ ok: false, status: 500, body: { ok: false, error: "Unauthorized" } });
    await expect(getSessionServerFn()).rejects.toThrow("セッションの取得に失敗しました");
  });
});
