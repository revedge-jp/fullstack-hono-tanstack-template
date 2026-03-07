import { describe, expect, test } from "bun:test";
import { ok } from "@repo/result";
import { reconstituteUser, type User } from "../../domain/models";
import type { UsersRepository } from "../../domain/users.repository";
import { makeGetUser } from "./usecase";

const ID_1 = "550e8400-e29b-41d4-a716-446655440001";
const ID_DUMMY = "00000000-0000-0000-0000-000000000000";
const ID_NOT_FOUND = "99999999-9999-9999-9999-999999999999";

describe("users.get usecase", () => {
  test("正常: ユーザーを返す", async () => {
    const mockUser = reconstituteUser({
      id: ID_1,
      email: "test@example.com",
      name: "Test User",
    });
    const usersRepository: UsersRepository = {
      list: async () => ok<User[]>([]),
      create: async () => ok(mockUser),
      getById: async () => ok(mockUser),
      update: async (user) => ok(user),
    };
    const usecase = makeGetUser({ usersRepository });
    const r = await usecase(ID_1);
    expect(r.type).toBe("ok");
    if (r.type === "ok") {
      expect(r.value.item).toEqual(mockUser);
    }
  });

  test("異常: ユーザーが存在しない場合は NotFound を返す", async () => {
    const usersRepository: UsersRepository = {
      list: async () => ok<User[]>([]),
      create: async () =>
        ok(reconstituteUser({ id: ID_DUMMY, email: "dummy@example.com", name: null })),
      getById: async () => ok(null),
      update: async (user) => ok(user),
    };
    const usecase = makeGetUser({ usersRepository });
    const r = await usecase(ID_NOT_FOUND);
    expect(r.type).toBe("err");
    if (r.type === "err") {
      expect(r.value).toBe("NotFound");
    }
  });
});
