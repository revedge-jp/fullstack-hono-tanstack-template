import { err, ok } from "@repo/result";
import type { Email, User, UserName } from "../features/users/domain/models";
import type { UsersRepository } from "../features/users/domain/users.repository";

export function createInMemoryUsersRepository(initial: User[] = []): UsersRepository {
  const users: User[] = [...initial];

  return {
    async list() {
      return ok<User[]>([...users]);
    },
    async create(input: { email: Email; name: UserName | null }) {
      const exists = users.some((u) => u.email === input.email);
      if (exists) {
        return err("Conflict" as const);
      }
      const user: User = {
        id: crypto.randomUUID(),
        email: input.email,
        name: input.name,
      };
      users.push(user);
      return ok(user);
    },
    async getById(id: string) {
      const user = users.find((u) => u.id === id) ?? null;
      return ok(user);
    },
    async update(user: User) {
      const idx = users.findIndex((u) => u.id === user.id);
      if (idx === -1) {
        return err("Unexpected" as const);
      }
      users[idx] = user;
      return ok(user);
    },
  };
}
