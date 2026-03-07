import { describe, expect, test } from "bun:test";
import { err, ok } from "@repo/result";
import { makeEmail, makeUserName, reconstituteUser, type User } from "../../domain/models";
import type { UsersRepository } from "../../domain/users.repository";
import { makeCreateUserStep } from "./steps";
import type { CreateUserValidatedInput } from "./validators";

function createValidInput(email: string, name: string | null): CreateUserValidatedInput {
  const emailResult = makeEmail(email);
  const nameResult = makeUserName(name);
  if (emailResult.type !== "ok" || nameResult.type !== "ok") {
    throw new Error("Invalid test data");
  }
  return { email: emailResult.value, name: nameResult.value };
}

const ID_1 = "550e8400-e29b-41d4-a716-446655440001";
const ID_2 = "550e8400-e29b-41d4-a716-446655440002";

describe("users.create steps", () => {
  test("正常: ユーザーを作成して返す", async () => {
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
    const step = makeCreateUserStep({ usersRepository });
    const r = await step(createValidInput("test@example.com", "Test User"));
    expect(r.type).toBe("ok");
    if (r.type === "ok") {
      expect(r.value.id).toBe(ID_1);
    }
  });

  test("正常: 名前が null のユーザーを作成して返す", async () => {
    const mockUser = reconstituteUser({
      id: ID_2,
      email: "test2@example.com",
      name: null,
    });
    const usersRepository: UsersRepository = {
      list: async () => ok<User[]>([]),
      create: async () => ok(mockUser),
      getById: async () => ok(null),
      update: async (user) => ok(user),
    };
    const step = makeCreateUserStep({ usersRepository });
    const r = await step(createValidInput("test2@example.com", null));
    expect(r.type).toBe("ok");
    if (r.type === "ok") {
      expect(r.value.id).toBe(ID_2);
    }
  });

  test("異常: メール重複で Conflict を返す", async () => {
    const usersRepository: UsersRepository = {
      list: async () => ok<User[]>([]),
      create: async () => err("Conflict"),
      getById: async () => ok(null),
      update: async (user) => ok(user),
    };
    const step = makeCreateUserStep({ usersRepository });
    const r = await step(createValidInput("existing@example.com", "User"));
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
    const step = makeCreateUserStep({ usersRepository });
    const r = await step(createValidInput("test@example.com", "User"));
    expect(r.type).toBe("err");
    if (r.type === "err") {
      expect(r.value).toBe("Unexpected");
    }
  });
});
