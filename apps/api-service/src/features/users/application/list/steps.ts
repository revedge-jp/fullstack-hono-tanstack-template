import type { Result } from "@repo/result";
import type { User } from "../../domain/models";
import type { UsersRepository } from "../../domain/users.repository";

// 入出力型（ファイルローカル）
type FetchUsersStepInput = null;
type FetchUsersStepOutput = Result<User[], "Unexpected">;

export function makeFetchUsersStep(deps: { usersRepository: UsersRepository }) {
  const { usersRepository } = deps;
  return async function fetchUsers(_: FetchUsersStepInput): Promise<FetchUsersStepOutput> {
    return usersRepository.list();
  };
}
