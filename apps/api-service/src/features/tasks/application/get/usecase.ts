import { okAsync, type ResultAsync } from "neverthrow";

import type { Task } from "../../domain/models";
import type { TasksRepository } from "../../domain/tasks.repository";
import { makeGetTaskStep } from "./steps";

type GetTaskInput = { id: string; ownerId: string };
type GetTaskError = "NotFound" | "Unexpected";

export function makeGetTask(deps: { tasksRepository: TasksRepository }) {
  const getTaskStep = makeGetTaskStep(deps);
  return function getTask(input: GetTaskInput): ResultAsync<Task, GetTaskError> {
    return okAsync(input).andThen(getTaskStep);
  };
}
