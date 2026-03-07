import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AppType } from "api-service";
import {
  createFakeApp,
  createInMemoryUsersRepository,
  reconstituteUser,
} from "api-service/test-helpers";
import { hc } from "hono/client";
import { processUpdateUser } from "./update";

mock.module("@tanstack/react-start", () => ({
  createServerFn: () => ({ inputValidator: () => ({ handler: () => ({}) }) }),
}));
mock.module("@/shared/lib/api", () => ({ apiClient: null }));

const ID_1 = "550e8400-e29b-41d4-a716-446655440001";
const ID_NOT_FOUND = "00000000-0000-0000-0000-000000000000";

function makeFakeApiClient(repo?: ReturnType<typeof createInMemoryUsersRepository>) {
  const app = createFakeApp(repo ? { usersRepository: repo } : {});
  return hc<AppType>("http://localhost", { fetch: app.request.bind(app) });
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
    const result = await processUpdateUser({ id: ID_1, name: "Alice Updated" }, client);
    expect(result.ok).toBe(true);
  });

  test("異常: 存在しないユーザーの場合は API の not found エラーを返す", async () => {
    const result = await processUpdateUser({ id: ID_NOT_FOUND, name: "Ghost" }, client);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("not found");
    }
  });
});
