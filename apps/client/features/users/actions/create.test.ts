import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AppType } from "api-service";
import { createFakeApp, type createInMemoryUsersRepository } from "api-service/test-helpers";
import { hc } from "hono/client";
import { processCreateUser } from "./create";

mock.module("@tanstack/react-start", () => ({
  createServerFn: () => ({ inputValidator: () => ({ handler: () => ({}) }) }),
}));
mock.module("@/shared/lib/api", () => ({ apiClient: null }));

function makeFakeApiClient(repo?: ReturnType<typeof createInMemoryUsersRepository>) {
  const app = createFakeApp(repo ? { usersRepository: repo } : {});
  return hc<AppType>("http://localhost", { fetch: app.request.bind(app) });
}

describe("processCreateUser", () => {
  let client: ReturnType<typeof makeFakeApiClient>;

  beforeEach(() => {
    client = makeFakeApiClient();
  });

  test("正常: 有効な入力でユーザーを作成する", async () => {
    const result = await processCreateUser({ email: "alice@example.com", name: "Alice" }, client);
    expect(result.ok).toBe(true);
  });

  test("正常: 空白の名前は null として扱う", async () => {
    const result = await processCreateUser({ email: "bob@example.com", name: "  " }, client);
    expect(result.ok).toBe(true);
  });

  test("異常: 同一メールが存在する場合は API コンフリクトエラーを返す", async () => {
    await processCreateUser({ email: "carol@example.com", name: "Carol" }, client);

    const result = await processCreateUser({ email: "carol@example.com", name: "Carol 2" }, client);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("conflict");
    }
  });
});
