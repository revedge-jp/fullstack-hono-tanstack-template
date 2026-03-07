import type { UsersRepository } from "../domain/users.repository";
import { makeCreateUser, makeGetUser, makeListUsers, makeUpdateUser } from "./index";

export type UsersService = ReturnType<typeof createUsersService>;

export function createUsersService(deps: { usersRepository: UsersRepository }) {
  const { usersRepository } = deps;

  const listUsers = makeListUsers({ usersRepository });
  const createUser = makeCreateUser({ usersRepository });
  const getUser = makeGetUser({ usersRepository });
  const updateUser = makeUpdateUser({ usersRepository });

  return { listUsers, createUser, getUser, updateUser };
}
