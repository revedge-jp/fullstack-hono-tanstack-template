import { err, isOk, ok, type Result } from "@repo/result";
import { changeUserName, type User } from "../../domain/models";
import type { UsersRepository } from "../../domain/users.repository";
import type { UpdateUserValidatedInput } from "./validators";

type UpdateUserStepInput = UpdateUserValidatedInput;
type UpdateUserStepOutput = Result<User, "Invalid" | "NotFound" | "Unexpected">;

export function makeUpdateUserStep(deps: { usersRepository: UsersRepository }) {
  const { usersRepository } = deps;
  return async function updateUserStep(input: UpdateUserStepInput): Promise<UpdateUserStepOutput> {
    const getResult = await usersRepository.getById(input.id);
    if (!isOk(getResult)) {
      return err("Unexpected");
    }
    const user = getResult.value;
    if (!user) {
      return err("NotFound");
    }

    const changeResult = changeUserName(user, input.name);
    if (changeResult.type !== "ok") {
      return err("Invalid");
    }

    const updateResult = await usersRepository.update(changeResult.value);
    if (!isOk(updateResult)) {
      return err("Unexpected");
    }
    return ok(updateResult.value);
  };
}
