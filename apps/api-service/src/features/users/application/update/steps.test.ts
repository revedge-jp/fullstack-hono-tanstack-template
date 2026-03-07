import { describe, expect, test } from "bun:test";
import { ok } from "@repo/result";
import { makeUserName, reconstituteUser, type User } from "../../domain/models";
import type { UsersRepository } from "../../domain/users.repository";
import { makeUpdateUserStep } from "./steps";
import type { UpdateUserValidatedInput } from "./validators";

const ID_1 = "550e8400-e29b-41d4-a716-446655440001";
const ID_2 = "550e8400-e29b-41d4-a716-446655440002";
const ID_DUMMY = "00000000-0000-0000-0000-000000000000";
const ID_NOT_FOUND = "99999999-9999-9999-9999-999999999999";

function createValidUpdateInput(id: string, name: string | null): UpdateUserValidatedInput {
  const nameResult = makeUserName(name);
  if (nameResult.type !== "ok") {
    throw new Error("Invalid test data");
  }
  return { id, name: nameResult.value };
}

describe("users.update steps", () => {
  test("正常: ユーザーを更新して返す", async () => {
    const mockUser = reconstituteUser({
      id: ID_1,
      email: "test@example.com",
      name: "Old Name",
    });
    const usersRepository: UsersRepository = {
      list: async () => ok<User[]>([]),
      create: async () => ok(mockUser),
      getById: async (id) => ok(id === ID_1 ? mockUser : null),
      update: async (user) =>
        ok(reconstituteUser({ id: user.id, email: user.email, name: user.name })),
    };
    const step = makeUpdateUserStep({ usersRepository });
    const r = await step(createValidUpdateInput(ID_1, "New Name"));
    expect(r.type).toBe("ok");
    if (r.type === "ok") {
      expect(r.value.name as string).toBe("New Name");
    }
  });

  test("正常: 名前を null に更新する", async () => {
    const mockUser = reconstituteUser({
      id: ID_2,
      email: "test2@example.com",
      name: "Has Name",
    });
    const usersRepository: UsersRepository = {
      list: async () => ok<User[]>([]),
      create: async () => ok(mockUser),
      getById: async (id) => ok(id === ID_2 ? mockUser : null),
      update: async (user) =>
        ok(reconstituteUser({ id: user.id, email: user.email, name: user.name })),
    };
    const step = makeUpdateUserStep({ usersRepository });
    const r = await step(createValidUpdateInput(ID_2, null));
    expect(r.type).toBe("ok");
    if (r.type === "ok") {
      expect(r.value.name).toBe(null);
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
    const step = makeUpdateUserStep({ usersRepository });
    const r = await step(createValidUpdateInput(ID_NOT_FOUND, "New Name"));
    expect(r.type).toBe("err");
    if (r.type === "err") {
      expect(r.value).toBe("NotFound");
    }
  });
});
