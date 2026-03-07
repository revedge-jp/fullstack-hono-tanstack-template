import type { UsersRepository } from "@features/users/domain/users.repository";
import { flow, type Result } from "@repo/result";
import { toGetUserResponse } from "./mappers";
import { makeGetUserStep } from "./steps";

type GetUserError = "NotFound" | "Unexpected";

export function makeGetUser(deps: { usersRepository: UsersRepository }) {
  const getUserStep = makeGetUserStep(deps);
  // レスポンス型は mappers.ts の戻り値から推論されるが、明示的に書くなら
  // ReturnType<typeof toGetUserResponse> を使うか、DTO型をexportして使う
  return async function getUser(
    id: string,
  ): Promise<Result<ReturnType<typeof toGetUserResponse>, GetUserError>> {
    return flow<string>(id).asyncAndThen(getUserStep).map(toGetUserResponse).value();
  };
}
