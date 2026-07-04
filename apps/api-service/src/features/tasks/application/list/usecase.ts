import { okAsync, type ResultAsync } from "neverthrow";
import type { Task } from "../../domain/models";
import type { TasksRepository } from "../../domain/tasks.repository";
import { makeFetchTasksStep } from "./steps";

type ListTasksInput = { ownerId: string };
type ListTasksError = "Unexpected";

export function makeListTasks(deps: { tasksRepository: TasksRepository }) {
  const fetchTasksStep = makeFetchTasksStep(deps);
  return function listTasks(input: ListTasksInput): ResultAsync<{ items: Task[] }, ListTasksError> {
    return okAsync(input).andThen(fetchTasksStep);
  };
}
