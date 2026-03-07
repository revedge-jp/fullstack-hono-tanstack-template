import type { Result } from "@repo/result";
import type { User } from "../../domain/models";
import type { UsersRepository } from "../../domain/users.repository";
import type { CreateUserValidatedInput } from "./validators";

type CreateUserStepInput = CreateUserValidatedInput;
type CreateUserStepOutput = Result<User, "Conflict" | "Unexpected">;

export function makeCreateUserStep(deps: { usersRepository: UsersRepository }) {
  const { usersRepository } = deps;
  return async function createUserStep(i: CreateUserStepInput): Promise<CreateUserStepOutput> {
    return usersRepository.create(i);
  };
}
