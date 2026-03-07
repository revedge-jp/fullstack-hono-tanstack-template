import { err, isOk, ok, type Result } from "@repo/result";
import type { User } from "../../domain/models";
import type { UsersRepository } from "../../domain/users.repository";

// 入出力型（ファイルローカル）
type GetUserStepInput = string;
type GetUserStepOutput = Result<User, "NotFound" | "Unexpected">;

export function makeGetUserStep(deps: { usersRepository: UsersRepository }) {
  const { usersRepository } = deps;
  return async function getUserStep(userId: GetUserStepInput): Promise<GetUserStepOutput> {
    const result = await usersRepository.getById(userId);
    if (!isOk(result)) {
      return err("Unexpected");
    }
    const user = result.value;
    return user ? ok(user) : err("NotFound");
  };
}
