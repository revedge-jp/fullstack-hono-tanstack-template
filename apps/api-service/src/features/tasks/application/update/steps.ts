import type { ResultAsync } from "neverthrow";

import { advanceTaskStatus, type Task } from "../../domain/models";
import type { TasksRepository } from "../../domain/tasks.repository";

type AdvanceTaskStepInput = Task;
type AdvanceTaskStepOutput = ResultAsync<
  Task,
  "AlreadyDone" | "NotFound" | "Conflict" | "Unexpected"
>;

export function makeAdvanceTaskStep(deps: { tasksRepository: TasksRepository }) {
  return function advanceTaskStep(task: AdvanceTaskStepInput): AdvanceTaskStepOutput {
    // 読んだ時点の status を条件に更新する（間に他の更新が入っていたら Conflict）
    return advanceTaskStatus(task).asyncAndThen((advanced) =>
      deps.tasksRepository.update(advanced, { status: task.status }),
    );
  };
}
