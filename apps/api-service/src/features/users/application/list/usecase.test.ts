import { describe, expect, test } from "bun:test";
import { ok } from "@repo/result";
import { reconstituteUser } from "../../domain/models";
import type { UsersRepository } from "../../domain/users.repository";
import { makeListUsers } from "./usecase";

const ID_1 = "550e8400-e29b-41d4-a716-446655440001";
const ID_2 = "550e8400-e29b-41d4-a716-446655440002";
const ID_DUMMY = "00000000-0000-0000-0000-000000000000";

describe("users.list usecase", () => {
  test("正常: ユーザー一覧を返す", async () => {
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
    const usecase = makeListUsers({ usersRepository });
    const r = await usecase();
    expect(r.type).toBe("ok");
    if (r.type === "ok") {
      expect(r.value.items).toHaveLength(mockUsers.length);
      expect(r.value.items[0]).toEqual({ id: ID_1, email: "a@example.com", name: "Alice" });
      expect(r.value.items[1]).toEqual({ id: ID_2, email: "b@example.com", name: null });
    }
  });
});
