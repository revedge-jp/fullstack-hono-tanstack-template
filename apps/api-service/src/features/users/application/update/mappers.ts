import type { User } from "@features/users/domain/models";
import type { UserDto } from "../dtos";

export function toUpdateUserResponse(user: User): { item: UserDto } {
  return {
    item: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  };
}
