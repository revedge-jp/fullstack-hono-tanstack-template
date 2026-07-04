import { okAsync, type ResultAsync } from "neverthrow";
import type { TasksRepository } from "../../domain/tasks.repository";
import { makeDeleteTaskStep } from "./steps";

type DeleteTaskInput = { id: string; ownerId: string };
type DeleteTaskError = "NotFound" | "Unexpected";

export function makeDeleteTask(deps: { tasksRepository: TasksRepository }) {
  const deleteTaskStep = makeDeleteTaskStep(deps);
  return function deleteTask(input: DeleteTaskInput): ResultAsync<void, DeleteTaskError> {
    return okAsync(input).andThen(deleteTaskStep);
  };
}
