import type { Result } from "@repo/result";
import type { Email, User, UserName } from "./models";

export type { User };

export type UsersRepository = {
  list(): Promise<Result<User[], "Unexpected">>;
  create(input: {
    email: Email;
    name: UserName | null;
  }): Promise<Result<User, "Conflict" | "Unexpected">>;
  getById(id: string): Promise<Result<User | null, "Unexpected">>;
  update(user: User): Promise<Result<User, "Unexpected">>;
};
