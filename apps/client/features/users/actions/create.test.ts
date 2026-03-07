import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AppType } from "api-service";
import { createFakeApp, type createInMemoryUsersRepository } from "api-service/test-helpers";
import { hc } from "hono/client";
import { processCreateUser } from "./create";

mock.module("next/cache", () => ({ updateTag: mock() }));
mock.module("@/shared/lib/api", () => ({ apiClient: null }));

function makeFakeApiClient(repo?: ReturnType<typeof createInMemoryUsersRepository>) {
  const app = createFakeApp(repo ? { usersRepository: repo } : {});
  return hc<AppType>("http://localhost", { fetch: app.request.bind(app) });
}

function makeFormData(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) {
    fd.append(k, v);
  }
  return fd;
}

describe("processCreateUser", () => {
  let client: ReturnType<typeof makeFakeApiClient>;

  beforeEach(() => {
    client = makeFakeApiClient();
  });

  test("正常: 有効な入力でユーザーを作成する", async () => {
    const formData = makeFormData({ email: "alice@example.com", name: "Alice" });
    const result = await processCreateUser(formData, client);
    expect(result.ok).toBe(true);
  });

  test("正常: 空白の名前は null として扱う", async () => {
    const formData = makeFormData({ email: "bob@example.com", name: "  " });
    const result = await processCreateUser(formData, client);
    expect(result.ok).toBe(true);
  });

  test("異常: 不正なメールアドレスはバリデーションエラーを返す", async () => {
    const formData = makeFormData({ email: "not-an-email", name: "Alice" });
    const result = await processCreateUser(formData, client);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBeTruthy();
    }
  });

  test("異常: 同一メールが存在する場合は API コンフリクトエラーを返す", async () => {
    const formData = makeFormData({ email: "carol@example.com", name: "Carol" });
    await processCreateUser(formData, client);

    const duplicate = makeFormData({ email: "carol@example.com", name: "Carol 2" });
    const result = await processCreateUser(duplicate, client);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("conflict");
    }
  });
});
