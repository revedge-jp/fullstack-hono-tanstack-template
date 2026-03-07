import { describe, expect, test } from "bun:test";
import { err, ok } from "@repo/result";
import { makeCreateUser } from "../../features/users/application/create/usecase";
import { validateCreateUser } from "../../features/users/application/create/validators";
import { reconstituteUser, type User } from "../../features/users/domain/models";
import type { UsersRepository } from "../../features/users/domain/users.repository";

const ID_BASE = "550e8400-e29b-41d4-a716-446655440000";

describe("scenario: users/create", () => {
  const baseUser = reconstituteUser({
    id: ID_BASE,
    email: "alice@example.com",
    name: "Alice",
  });

  const stubRepository: UsersRepository = {
    list: async () => ok([baseUser]),
    create: async (input) =>
      ok<User>(
        reconstituteUser({
          id: baseUser.id,
          email: input.email,
          name: input.name,
        }),
      ),
    getById: async (id) => ok(id === baseUser.id ? baseUser : null),
    update: async (user) => ok(user),
  };

  test("正常: ユーザーを正常に作成する", async () => {
    const createUser = makeCreateUser({
      usersRepository: stubRepository,
    });
    const result = await createUser({
      email: "alice@example.com",
      name: "Alice",
    });
    expect(result.type).toBe("ok");
    if (result.type === "ok") {
      expect(result.value.item.id).toBe(baseUser.id);
    }
  });

  test("異常: 不正なユーザー名はバリデーション失敗を返す", () => {
    const validation = validateCreateUser({
      email: "alice@example.com",
      name: "",
    });
    expect(validation).toEqual(err("Invalid"));
  });
});
