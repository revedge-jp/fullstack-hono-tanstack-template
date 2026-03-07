import { describe, expect, test } from "bun:test";
import { err, ok } from "@repo/result";
import { reconstituteUser, type User } from "../../domain/models";
import type { UsersRepository } from "../../domain/users.repository";
import { makeCreateUser } from "./usecase";

const ID_1 = "550e8400-e29b-41d4-a716-446655440001";

describe("users.create usecase", () => {
  test("正常: 有効な入力でユーザーを作成する", async () => {
    const mockUser = reconstituteUser({
      id: ID_1,
      email: "test@example.com",
      name: "Test User",
    });
    const usersRepository: UsersRepository = {
      list: async () => ok<User[]>([]),
      create: async () => ok(mockUser),
      getById: async () => ok(null),
      update: async (user) => ok(user),
    };
    const usecase = makeCreateUser({ usersRepository });
    const r = await usecase({
      email: "test@example.com",
      name: "Test User",
    });
    expect(r.type).toBe("ok");
    if (r.type === "ok") {
      expect(r.value.item.id).toBe(ID_1);
    }
  });

  test("異常: バリデーション失敗で Invalid を返す", async () => {
    const usersRepository: UsersRepository = {
      list: async () => ok<User[]>([]),
      create: async () =>
        ok(reconstituteUser({ id: ID_1, email: "dummy@example.com", name: null })),
      getById: async () => ok(null),
      update: async (user) => ok(user),
    };
    const usecase = makeCreateUser({ usersRepository });
    const r = await usecase({
      email: "invalid-email",
      name: "User",
    });
    expect(r.type).toBe("err");
    if (r.type === "err") {
      expect(r.value).toBe("Invalid");
    }
  });

  test("異常: メール重複で Conflict を返す", async () => {
    const usersRepository: UsersRepository = {
      list: async () => ok<User[]>([]),
      create: async () => err("Conflict"),
      getById: async () => ok(null),
      update: async (user) => ok(user),
    };
    const usecase = makeCreateUser({ usersRepository });
    const r = await usecase({
      email: "existing@example.com",
      name: "User",
    });
    expect(r.type).toBe("err");
    if (r.type === "err") {
      expect(r.value).toBe("Conflict");
    }
  });

  test("異常: リポジトリが Unexpected を返す場合は Unexpected を返す", async () => {
    const usersRepository: UsersRepository = {
      list: async () => ok<User[]>([]),
      create: async () => err("Unexpected"),
      getById: async () => ok(null),
      update: async (user) => ok(user),
    };
    const usecase = makeCreateUser({ usersRepository });
    const r = await usecase({
      email: "test@example.com",
      name: "User",
    });
    expect(r.type).toBe("err");
    if (r.type === "err") {
      expect(r.value).toBe("Unexpected");
    }
  });
});
