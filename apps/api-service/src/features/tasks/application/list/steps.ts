import type { ResultAsync } from "neverthrow";

import type { Task } from "../../domain/models";
import type { TasksRepository } from "../../domain/tasks.repository";
import type { ListTasksValidated } from "./validators";

type FetchTasksStepOutput = ResultAsync<{ items: Task[]; hasMore: boolean }, "Unexpected">;

export function makeFetchTasksStep(deps: { tasksRepository: TasksRepository }) {
  return function fetchTasksStep(input: ListTasksValidated): FetchTasksStepOutput {
    return deps.tasksRepository.list(input);
  };
}
