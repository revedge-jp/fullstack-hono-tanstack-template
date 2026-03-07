import type { User } from "@features/users/domain/models";
import type { UserDto } from "../dtos";

export function toListUsersResponse(users: User[]): { items: UserDto[] } {
  return {
    items: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
    })),
  };
}
