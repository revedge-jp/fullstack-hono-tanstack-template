import { describe, expect, test } from "bun:test";
import { createUsersRouter } from "@features/users/presentation";
import { ok } from "@repo/result";
import { Hono } from "hono";
import { hc } from "hono/client";
import type { UsersService } from "../../features/users/application/service";
import { reconstituteUser } from "../../features/users/domain/models";
import type { User } from "../../features/users/domain/users.repository";

const ID_1 = "550e8400-e29b-41d4-a716-446655440001";
const ID_2 = "550e8400-e29b-41d4-a716-446655440002";

const listItems: User[] = [
  reconstituteUser({
    id: ID_1,
    email: "alice@example.com",
    name: "Alice",
  }),
];

const stubService: UsersService = {
  listUsers: async () => ok({ items: listItems }),
  createUser: async () => ok({ item: { id: ID_2 } }),
  getUser: async () => ok({ item: listItems[0]! }),
  updateUser: async () => ok({ item: listItems[0]! }),
};

describe("contract: users ルート", () => {
  const app = new Hono().route("/", createUsersRouter({ users: stubService }));

  // hc() の fetch オプションは (input: URL | RequestInfo) を受け取るため、app.fetch に合わせてラップ
  const testFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    app.fetch(new Request(input, init));
  const testClient = hc<typeof app>("http://localhost", { fetch: testFetch });

  test("GET /: 正しいスキーマでユーザー一覧を返す", async () => {
    // Hono RPC: "/" にマウントしたルートは hc() 上で `.index` プロパティ経由でアクセスする
    const res = await testClient.index.$get();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("items");
    expect(Array.isArray((json as { items: unknown[] }).items)).toBe(true);
  });

  test("POST /: ユーザーを作成して item.id を返す", async () => {
    const res = await testClient.index.$post({
      json: { email: "bob@example.com", name: "Bob" },
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    if ("item" in json) {
      expect((json.item as { id: string }).id).toBe(ID_2);
    } else {
      throw new Error("Expected item in response");
    }
  });
});
