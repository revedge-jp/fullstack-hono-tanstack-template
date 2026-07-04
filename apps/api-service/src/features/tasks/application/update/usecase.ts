import { okAsync, type ResultAsync } from "neverthrow";

import type { Task } from "../../domain/models";
import type { TasksRepository } from "../../domain/tasks.repository";
import { makeGetTaskStep } from "../get/steps";
import { makeAdvanceTaskStep } from "./steps";

type AdvanceTaskInput = { id: string; ownerId: string };
type AdvanceTaskError = "AlreadyDone" | "NotFound" | "Unexpected";

export function makeAdvanceTask(deps: { tasksRepository: TasksRepository }) {
  const getTaskStep = makeGetTaskStep(deps);
  const advanceTaskStep = makeAdvanceTaskStep(deps);
  return function advanceTask(input: AdvanceTaskInput): ResultAsync<Task, AdvanceTaskError> {
    return okAsync(input).andThen(getTaskStep).andThen(advanceTaskStep);
  };
}
