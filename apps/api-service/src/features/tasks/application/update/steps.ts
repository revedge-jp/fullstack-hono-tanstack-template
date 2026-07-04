import type { ResultAsync } from "neverthrow";
import { advanceTaskStatus, type Task } from "../../domain/models";
import type { TasksRepository } from "../../domain/tasks.repository";

type AdvanceTaskStepInput = Task;
type AdvanceTaskStepOutput = ResultAsync<Task, "AlreadyDone" | "NotFound" | "Unexpected">;

export function makeAdvanceTaskStep(deps: { tasksRepository: TasksRepository }) {
  return function advanceTaskStep(task: AdvanceTaskStepInput): AdvanceTaskStepOutput {
    return advanceTaskStatus(task).asyncAndThen((advanced) =>
      deps.tasksRepository.update(advanced),
    );
  };
}
