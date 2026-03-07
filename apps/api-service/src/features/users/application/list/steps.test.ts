import { describe, expect, test } from "bun:test";
import { err, ok } from "@repo/result";
import { reconstituteUser, type User } from "../../domain/models";
import type { UsersRepository } from "../../domain/users.repository";
import { makeFetchUsersStep } from "./steps";

const ID_1 = "550e8400-e29b-41d4-a716-446655440001";
const ID_2 = "550e8400-e29b-41d4-a716-446655440002";
const ID_DUMMY = "00000000-0000-0000-0000-000000000000";

describe("users.list steps", () => {
  test("正常: リポジトリからユーザー一覧を返す", async () => {
    const mockUsers = [
      reconstituteUser({ id: ID_1, email: "a@example.com", name: "Alice" }),
      reconstituteUser({ id: ID_2, email: "b@example.com", name: null }),
    ];
    const usersRepository: UsersRepository = {
      list: async () => ok(mockUsers),
      create: async () =>
        ok(reconstituteUser({ id: ID_DUMMY, email: "dummy@example.com", name: null })),
      getById: async () => ok(null),
      update: async (user) => ok(user),
    };
    const step = makeFetchUsersStep({ usersRepository });
    const r = await step(null);
    expect(r.type).toBe("ok");
    if (r.type === "ok") {
      expect(r.value).toEqual(mockUsers);
    }
  });

  test("正常: ユーザーが存在しない場合は空配列を返す", async () => {
    const usersRepository: UsersRepository = {
      list: async () => ok<User[]>([]),
      create: async () =>
        ok(reconstituteUser({ id: ID_DUMMY, email: "dummy@example.com", name: null })),
      getById: async () => ok(null),
      update: async (user) => ok(user),
    };
    const step = makeFetchUsersStep({ usersRepository });
    const r = await step(null);
    expect(r.type).toBe("ok");
    if (r.type === "ok") {
      expect(r.value).toEqual([]);
    }
  });

  test("異常: リポジトリがエラーを返す場合は Unexpected を返す", async () => {
    const usersRepository: UsersRepository = {
      list: async () => err("Unexpected"),
      create: async () =>
        ok(reconstituteUser({ id: ID_DUMMY, email: "dummy@example.com", name: null })),
      getById: async () => ok(null),
      update: async (user) => ok(user),
    };
    const step = makeFetchUsersStep({ usersRepository });
    const r = await step(null);
    expect(r.type).toBe("err");
    if (r.type === "err") {
      expect(r.value).toBe("Unexpected");
    }
  });
});
