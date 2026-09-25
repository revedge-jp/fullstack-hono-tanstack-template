import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";

import { QueryClient } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";

import type { SessionUser } from "@/shared/lib/api-client";
import { createApiMock, reactStartModule, reactStartServerModule } from "@/test-helpers/api-mock";

const mockUser: SessionUser = { id: "u1", email: "a@example.com", name: "A" };

const api = createApiMock({ body: { ok: true, data: mockUser } });
await mock.module("@/shared/lib/api-client", api.apiClientModule);
await mock.module("@tanstack/react-start", reactStartModule);
await mock.module("@tanstack/react-start/server", reactStartServerModule());

const { getSessionServerFn, requireSessionUser, sessionQueryOptions } =
  await import("./get-session");

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

describe("auth.sessionQueryOptions", () => {
  beforeEach(() => api.reset());

  test('queryKey は ["session"]（サインアウトの queryClient.clear() と beforeLoad のデデュープが同じキーを見る）', () => {
    expect([...sessionQueryOptions().queryKey]).toEqual(["session"]);
  });

  test("queryFn は getSessionServerFn の結果をそのまま返す（未認証は null）", async () => {
    const queryFn = sessionQueryOptions().queryFn;
    expect(queryFn).toBeDefined();
    expect(await queryFn!({} as never)).toEqual(mockUser);
    api.reset({ ok: false, status: 401, body: { ok: false, error: "Unauthorized" } });
    expect(await queryFn!({} as never)).toBeNull();
  });
});

// _authenticated の beforeLoad が使うガード。**今回直した不具合そのもの**（セッションが切れても
// キャッシュのせいでガードを素通りする）を、本物の QueryClient と時刻の差し替えで確かめる。
// ensureQueryData に戻すと「30 秒を過ぎたら /signin」のテストが落ちる。
describe("auth.requireSessionUser", () => {
  const start = new Date("2026-01-01T00:00:00Z");

  beforeEach(() => {
    api.reset();
    setSystemTime(start);
  });

  afterEach(() => {
    setSystemTime();
  });

  async function expectRedirectToSignin(promise: Promise<unknown>) {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(isRedirect(error)).toBe(true);
    expect((error as { options: { to: string } }).options.to).toBe("/signin");
  }

  test("ログイン済みならユーザーを返す", async () => {
    const queryClient = new QueryClient();
    expect(await requireSessionUser(queryClient)).toEqual(mockUser);
  });

  test("未ログインなら /signin への redirect を throw する", async () => {
    api.reset({ ok: false, status: 401, body: { ok: false, error: "Unauthorized" } });
    await expectRedirectToSignin(requireSessionUser(new QueryClient()));
  });

  test("セッションが切れても 30 秒以内はキャッシュで通し（遷移ごとに /api/me を叩かない）、30 秒を過ぎたら取り直して /signin へ送る", async () => {
    const queryClient = new QueryClient();
    expect(await requireSessionUser(queryClient)).toEqual(mockUser);

    api.reset({ ok: false, status: 401, body: { ok: false, error: "Unauthorized" } });
    setSystemTime(new Date(start.getTime() + 29_000));
    expect(await requireSessionUser(queryClient)).toEqual(mockUser);
    // reset 後に /api/me が呼ばれていない（キャッシュで通った）
    expect(api.state.lastPath).toBeUndefined();

    setSystemTime(new Date(start.getTime() + 31_000));
    await expectRedirectToSignin(requireSessionUser(queryClient));
  });

  test("staleTime は全体の既定に頼らず 30 秒を明示している（既定が 0 の QueryClient でも同じ）", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 0 } } });
    expect(await requireSessionUser(queryClient)).toEqual(mockUser);
    api.reset({ ok: false, status: 401, body: { ok: false, error: "Unauthorized" } });
    setSystemTime(new Date(start.getTime() + 10_000));
    expect(await requireSessionUser(queryClient)).toEqual(mockUser);
  });
});
