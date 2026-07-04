import type { ResultAsync } from "neverthrow";

import type { TasksRepository } from "../../domain/tasks.repository";

type DeleteTaskStepInput = { id: string; ownerId: string };
type DeleteTaskStepOutput = ResultAsync<void, "NotFound" | "Unexpected">;

export function makeDeleteTaskStep(deps: { tasksRepository: TasksRepository }) {
  return function deleteTaskStep(input: DeleteTaskStepInput): DeleteTaskStepOutput {
    return deps.tasksRepository.delete(input.id, input.ownerId);
  };
}
