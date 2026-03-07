import type { UsersRepository } from "@features/users/domain/users.repository";
import { flow, type Result } from "@repo/result";
import { toUpdateUserResponse } from "./mappers";
import { makeUpdateUserStep } from "./steps";
import { type UpdateUserInput, validateUpdateUser } from "./validators";

type UpdateUserError = "Invalid" | "NotFound" | "Unexpected";

export function makeUpdateUser(deps: { usersRepository: UsersRepository }) {
  const updateUserStep = makeUpdateUserStep(deps);
  return async function updateUser(
    input: UpdateUserInput,
  ): Promise<Result<ReturnType<typeof toUpdateUserResponse>, UpdateUserError>> {
    return flow<UpdateUserInput>(input)
      .andThen(validateUpdateUser)
      .asyncAndThen(updateUserStep)
      .map(toUpdateUserResponse)
      .value();
  };
}
