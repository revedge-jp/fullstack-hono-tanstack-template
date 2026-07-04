import type { ResultAsync } from "neverthrow";
import type { Task } from "../../domain/models";
import type { TasksRepository } from "../../domain/tasks.repository";

type FetchTasksStepInput = { ownerId: string };
type FetchTasksStepOutput = ResultAsync<{ items: Task[] }, "Unexpected">;

export function makeFetchTasksStep(deps: { tasksRepository: TasksRepository }) {
  return function fetchTasksStep(input: FetchTasksStepInput): FetchTasksStepOutput {
    return deps.tasksRepository.list(input);
  };
}
