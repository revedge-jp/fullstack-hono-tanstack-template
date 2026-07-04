import { err, ok, type ResultAsync } from "neverthrow";
import type { Task } from "../../domain/models";
import type { TasksRepository } from "../../domain/tasks.repository";

type GetTaskStepInput = { id: string; ownerId: string };
type GetTaskStepOutput = ResultAsync<Task, "NotFound" | "Unexpected">;

export function makeGetTaskStep(deps: { tasksRepository: TasksRepository }) {
  return function getTaskStep(input: GetTaskStepInput): GetTaskStepOutput {
    return deps.tasksRepository
      .getById(input.id, input.ownerId)
      .andThen((task) => (task ? ok(task) : err("NotFound" as const)));
  };
}
