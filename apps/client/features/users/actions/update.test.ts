import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AppType } from "api-service";
import {
  createFakeApp,
  createInMemoryUsersRepository,
  reconstituteUser,
} from "api-service/test-helpers";
import { hc } from "hono/client";
import { processUpdateUser } from "./update";

mock.module("next/cache", () => ({ updateTag: mock() }));
mock.module("@/shared/lib/api", () => ({ apiClient: null }));

const ID_1 = "550e8400-e29b-41d4-a716-446655440001";
const ID_NOT_FOUND = "00000000-0000-0000-0000-000000000000";

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

describe("processUpdateUser", () => {
  let repo: ReturnType<typeof createInMemoryUsersRepository>;
  let client: ReturnType<typeof makeFakeApiClient>;

  beforeEach(() => {
    repo = createInMemoryUsersRepository([
      reconstituteUser({ id: ID_1, email: "alice@example.com", name: "Alice" }),
    ]);
    client = makeFakeApiClient(repo);
  });

  test("正常: 有効な入力でユーザーを更新する", async () => {
    const formData = makeFormData({ userId: ID_1, name: "Alice Updated" });
    const result = await processUpdateUser(formData, client);
    expect(result.ok).toBe(true);
  });

  test("異常: userId が未指定の場合はバリデーションエラーを返す", async () => {
    const formData = makeFormData({ name: "Alice" });
    const result = await processUpdateUser(formData, client);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("Invalid user id");
    }
  });

  test("異常: userId が UUID 形式でない場合はバリデーションエラーを返す", async () => {
    const formData = makeFormData({ userId: "not-a-uuid", name: "Alice" });
    const result = await processUpdateUser(formData, client);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("Invalid user id");
    }
  });

  test("異常: 存在しないユーザーの場合は API の not found エラーを返す", async () => {
    const formData = makeFormData({
      userId: ID_NOT_FOUND,
      name: "Ghost",
    });
    const result = await processUpdateUser(formData, client);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("not found");
    }
  });
});
