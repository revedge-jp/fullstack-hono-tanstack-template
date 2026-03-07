import type { User as DbUser } from "@repo/db";
import { type User as DomainUser, reconstituteUser } from "../domain/models";

export function mapDbUserToDomain(user: DbUser): DomainUser {
  return reconstituteUser({
    id: user.id,
    email: user.email,
    name: user.name,
  });
}
