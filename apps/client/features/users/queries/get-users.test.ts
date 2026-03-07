import { describe, expect, test } from "bun:test";
import type { AppType } from "api-service";
import {
  createFakeApp,
  createInMemoryUsersRepository,
  reconstituteUser,
} from "api-service/test-helpers";
import { hc } from "hono/client";
import { getUsers } from "./get-users";

const ID_1 = "550e8400-e29b-41d4-a716-446655440001";
const ID_2 = "550e8400-e29b-41d4-a716-446655440002";

function makeFakeApiClient(usersRepository?: ReturnType<typeof createInMemoryUsersRepository>) {
  const fakeApp = createFakeApp(usersRepository ? { usersRepository } : {});
  return hc<AppType>("http://localhost", {
    fetch: fakeApp.request.bind(fakeApp),
  });
}

describe("getUsers", () => {
  test("正常: フェイクアプリからユーザー一覧を返す", async () => {
    const usersRepository = createInMemoryUsersRepository([
      reconstituteUser({ id: ID_1, email: "alice@example.com", name: "Alice" }),
      reconstituteUser({ id: ID_2, email: "bob@example.com", name: null }),
    ]);
    const apiClient = makeFakeApiClient(usersRepository);

    const users = await getUsers({ apiClient });

    expect(users).toHaveLength(2);
    expect(users[0]?.email).toBe("alice@example.com");
    expect(users[0]?.name).toBe("Alice");
    expect(users[1]?.email).toBe("bob@example.com");
    expect(users[1]?.name).toBeNull();
  });

  test("正常: ユーザーが存在しない場合は空配列を返す", async () => {
    const apiClient = makeFakeApiClient();

    const users = await getUsers({ apiClient });

    expect(users).toHaveLength(0);
  });

  test("正常: リポジトリ経由で作成したユーザーがリストに反映される", async () => {
    const usersRepository = createInMemoryUsersRepository();
    const apiClient = makeFakeApiClient(usersRepository);

    await apiClient.api.users.$post({
      json: { email: "carol@example.com", name: "Carol" },
    });

    const users = await getUsers({ apiClient });

    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBe("carol@example.com");
  });
});
