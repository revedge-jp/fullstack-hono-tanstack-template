import { err, isOk, ok, type Result } from "@repo/result";
import { makeUserName, type UserName } from "../../domain/models";

export type UpdateUserInput = { id: string; name: string | null };

export type UpdateUserValidatedInput = { id: string; name: UserName | null };

/**
 * ユーザー更新入力をバリデーションする
 * Domain の makeUserName で不変条件を検証
 */
export function validateUpdateUser(
  input: UpdateUserInput,
): Result<UpdateUserValidatedInput, "Invalid"> {
  const nameResult = makeUserName(input.name);
  if (!isOk(nameResult)) {
    return err("Invalid");
  }
  return ok({ id: input.id, name: nameResult.value });
}
