import { err, ok, type Result } from "neverthrow";

import { makeTaskTitle, type TaskTitle } from "../../domain/models";

export type CreateTaskInput = { ownerId: string; title: string };
export type CreateTaskValidated = { ownerId: string; title: TaskTitle };

export function validateCreateTask(input: CreateTaskInput): Result<CreateTaskValidated, "Invalid"> {
  const titleResult = makeTaskTitle(input.title);
  if (titleResult.isErr()) {
    return err("Invalid" as const);
  }
  return ok({ ownerId: input.ownerId, title: titleResult.value });
}
