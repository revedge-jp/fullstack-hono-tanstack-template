import type { PrismaClient } from "@repo/db";
import { err, ok, type Result } from "@repo/result";
import type { Email, User, UserName } from "../domain/models";
import type { UsersRepository as DomainUsersRepository } from "../domain/users.repository";
import { mapDbUserToDomain } from "./mappers";

export function createUsersRepository(deps: { prisma: PrismaClient }): DomainUsersRepository {
  const { prisma } = deps;

  return {
    async list(): Promise<Result<User[], "Unexpected">> {
      try {
        const rows = await prisma.user.findMany({ orderBy: { id: "desc" } });
        return ok(rows.map(mapDbUserToDomain));
      } catch {
        return err("Unexpected");
      }
    },
    async create(input: {
      email: Email;
      name: UserName | null;
    }): Promise<Result<User, "Conflict" | "Unexpected">> {
      try {
        const row = await prisma.user.create({ data: input });
        return ok(mapDbUserToDomain(row));
      } catch (e: unknown) {
        if (
          typeof e === "object" &&
          e !== null &&
          "code" in e &&
          (e as { code?: string }).code === "P2002"
        ) {
          return err("Conflict");
        }
        return err("Unexpected");
      }
    },
    async getById(id: string): Promise<Result<User | null, "Unexpected">> {
      try {
        const row = await prisma.user.findUnique({ where: { id } });
        return ok(row ? mapDbUserToDomain(row) : null);
      } catch {
        return err("Unexpected");
      }
    },
    async update(user: User): Promise<Result<User, "Unexpected">> {
      try {
        const row = await prisma.user.update({
          where: { id: user.id },
          data: { name: user.name },
        });
        return ok(mapDbUserToDomain(row));
      } catch {
        return err("Unexpected");
      }
    },
  };
}
