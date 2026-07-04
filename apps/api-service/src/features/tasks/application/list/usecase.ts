import { okAsync, type ResultAsync } from "neverthrow";

import type { TasksRepository } from "../../domain/tasks.repository";
import { type ListTasksResponse, toListTasksResponse } from "./mappers";
import { makeFetchTasksStep } from "./steps";
import { type ListTasksInput, validateListTasks } from "./validators";

type ListTasksError = "Invalid" | "Unexpected";

export function makeListTasks(deps: { tasksRepository: TasksRepository }) {
  const fetchTasksStep = makeFetchTasksStep(deps);
  return function listTasks(input: ListTasksInput): ResultAsync<ListTasksResponse, ListTasksError> {
    return okAsync(input)
      .andThen(validateListTasks)
      .andThen(fetchTasksStep)
      .map(toListTasksResponse);
  };
}
