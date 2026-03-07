import { err, isOk, ok, type Result } from "@repo/result";
import { type Email, makeEmail, makeUserName, type UserName } from "../../domain/models";

export type CreateUserInput = { email: string; name: string | null };

export type CreateUserValidatedInput = { email: Email; name: UserName | null };

/**
 * ユーザー作成入力をバリデーションする
 * Domain の makeEmail / makeUserName で不変条件を検証し、Value Object を返す
 */
export function validateCreateUser(
  input: CreateUserInput,
): Result<CreateUserValidatedInput, "Invalid"> {
  const emailResult = makeEmail(input.email);
  if (!isOk(emailResult)) {
    return err("Invalid");
  }

  const nameResult = makeUserName(input.name);
  if (!isOk(nameResult)) {
    return err("Invalid");
  }

  return ok({ email: emailResult.value, name: nameResult.value });
}
