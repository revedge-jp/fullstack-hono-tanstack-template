import type { UsersRepository } from "@features/users/domain/users.repository";
import { flow, type Result } from "@repo/result";
import { toListUsersResponse } from "./mappers";
import { makeFetchUsersStep } from "./steps";

type ListUsersError = "Unexpected";

export function makeListUsers(deps: { usersRepository: UsersRepository }) {
  const { usersRepository } = deps;
  const fetchUsersStep = makeFetchUsersStep({ usersRepository });
  return async function listUsers(): Promise<
    Result<ReturnType<typeof toListUsersResponse>, ListUsersError>
  > {
    return flow<null>(null).asyncAndThen(fetchUsersStep).map(toListUsersResponse).value();
  };
}
