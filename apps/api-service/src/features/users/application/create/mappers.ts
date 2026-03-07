import type { User } from "@features/users/domain/models";

export function toCreateUserResponse(user: User): { item: { id: string } } {
  return {
    item: { id: user.id },
  };
}
