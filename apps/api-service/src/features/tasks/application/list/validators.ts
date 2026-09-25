import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

import { decodeTaskCursor, type TaskCursor } from "./cursor";

export const DEFAULT_TASKS_PAGE_SIZE = 20;
export const MAX_TASKS_PAGE_SIZE = 100;

export type ListTasksInput = { ownerId: string; cursor?: string; limit?: number };
export type ListTasksValidated = { ownerId: string; limit: number; after?: TaskCursor };

export function validateListTasks(input: ListTasksInput): Result<ListTasksValidated, "Invalid"> {
  const limit = input.limit ?? DEFAULT_TASKS_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TASKS_PAGE_SIZE) {
    return err("Invalid" as const);
  }

  if (input.cursor === undefined) {
    return ok({ ownerId: input.ownerId, limit });
  }

  const decoded = decodeTaskCursor(input.cursor);
  if (decoded.isErr()) {
    return err("Invalid" as const);
  }
  // tasks.id は uuid 列なので、UUID でない id をリポジトリに渡すと PostgreSQL の 22P02 で 500 になる
  // （in-memory 実装は文字列比較で通ってしまい、contract テストでは見えない）。改ざん・破損したカーソルとして 400 にする
  if (!z.uuid().safeParse(decoded.value.id).success) {
    return err("Invalid" as const);
  }
  return ok({ ownerId: input.ownerId, limit, after: decoded.value });
}
