import { describe, expect, test } from "bun:test";
import { reconstituteUser } from "../features/users/domain/models";
import { createInMemoryUsersRepository } from "./users.inmemory.repository";

const ID_1 = "550e8400-e29b-41d4-a716-446655440001";
const ID_2 = "550e8400-e29b-41d4-a716-446655440002";
const ID_NOT_FOUND = "99999999-9999-9999-9999-999999999999";

const user1 = reconstituteUser({ id: ID_1, email: "alice@example.com", name: "Alice" });
const user2 = reconstituteUser({ id: ID_2, email: "bob@example.com", name: null });

describe("createInMemoryUsersRepository", () => {
  describe("list", () => {
    test("正常: ユーザーが存在しない場合は空配列を返す", async () => {
      const repo = createInMemoryUsersRepository();
      const r = await repo.list();
      expect(r.type).toBe("ok");
      if (r.type === "ok") {
        expect(r.value).toEqual([]);
      }
    });

    test("正常: 初期データを返す", async () => {
      const repo = createInMemoryUsersRepository([user1, user2]);
      const r = await repo.list();
      expect(r.type).toBe("ok");
      if (r.type === "ok") {
        expect(r.value).toHaveLength(2);
        expect(r.value[0]?.email as string).toBe("alice@example.com");
        expect(r.value[1]?.email as string).toBe("bob@example.com");
      }
    });
  });

  describe("create", () => {
    test("正常: ユーザーを追加して返す", async () => {
      const repo = createInMemoryUsersRepository();
      const r = await repo.create({ email: user1.email, name: user1.name });
      expect(r.type).toBe("ok");
      if (r.type === "ok") {
        expect(r.value.email as string).toBe("alice@example.com");
        expect(r.value.name as string).toBe("Alice");
        expect(typeof r.value.id).toBe("string");
      }

      const list = await repo.list();
      expect(list.type).toBe("ok");
      if (list.type === "ok") {
        expect(list.value).toHaveLength(1);
      }
    });

    test("異常: 同一メールが存在する場合は Conflict を返す", async () => {
      const repo = createInMemoryUsersRepository([user1]);
      const r = await repo.create({ email: user1.email, name: null });
      expect(r.type).toBe("err");
      if (r.type === "err") {
        expect(r.value).toBe("Conflict");
      }
    });
  });

  describe("getById", () => {
    test("正常: 存在するユーザーを返す", async () => {
      const repo = createInMemoryUsersRepository([user1]);
      const r = await repo.getById(ID_1);
      expect(r.type).toBe("ok");
      if (r.type === "ok") {
        expect(r.value).toEqual(user1);
      }
    });

    test("正常: 存在しない場合は null を返す", async () => {
      const repo = createInMemoryUsersRepository([user1]);
      const r = await repo.getById(ID_NOT_FOUND);
      expect(r.type).toBe("ok");
      if (r.type === "ok") {
        expect(r.value).toBeNull();
      }
    });
  });

  describe("update", () => {
    test("正常: ユーザーを更新して返す", async () => {
      const repo = createInMemoryUsersRepository([user1]);
      const updated = reconstituteUser({ id: ID_1, email: "alice@example.com", name: "Alice B" });
      const r = await repo.update(updated);
      expect(r.type).toBe("ok");
      if (r.type === "ok") {
        expect(r.value.name as string).toBe("Alice B");
      }

      const fetched = await repo.getById(ID_1);
      expect(fetched.type).toBe("ok");
      if (fetched.type === "ok") {
        expect(fetched.value?.name as string).toBe("Alice B");
      }
    });

    test("異常: 存在しないユーザーの場合は Unexpected を返す", async () => {
      const repo = createInMemoryUsersRepository();
      const ghost = reconstituteUser({ id: ID_NOT_FOUND, email: "ghost@example.com", name: null });
      const r = await repo.update(ghost);
      expect(r.type).toBe("err");
      if (r.type === "err") {
        expect(r.value).toBe("Unexpected");
      }
    });
  });
});
