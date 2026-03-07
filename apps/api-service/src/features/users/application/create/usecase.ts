import type { UsersRepository } from "@features/users/domain/users.repository";
import { flow, type Result } from "@repo/result";
import { toCreateUserResponse } from "./mappers";
import { makeCreateUserStep } from "./steps";
import { type CreateUserInput, validateCreateUser } from "./validators";

type CreateUserError = "Conflict" | "Invalid" | "Unexpected";

export function makeCreateUser(deps: { usersRepository: UsersRepository }) {
  const createUserStep = makeCreateUserStep(deps);
  return async function createUser(
    input: CreateUserInput,
  ): Promise<Result<{ item: { id: string } }, CreateUserError>> {
    return flow<CreateUserInput>(input)
      .andThen(validateCreateUser)
      .asyncAndThen(createUserStep)
      .map(toCreateUserResponse)
      .value();
  };
}
