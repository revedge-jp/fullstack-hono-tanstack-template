import type { ResultAsync } from "neverthrow";
import type { TasksRepository } from "../../domain/tasks.repository";
import type { ActivityRecorder } from "../ports";
import type { CreateTaskValidated } from "./validators";

type CreateTaskStepOutput = ResultAsync<{ item: { id: string } }, "Conflict" | "Unexpected">;

export function makeCreateTaskStep(deps: {
  tasksRepository: TasksRepository;
  activityRecorder: ActivityRecorder;
}) {
  return function createTaskStep(input: CreateTaskValidated): CreateTaskStepOutput {
    return deps.tasksRepository
      .create(input)
      .andThen((task) =>
        // activity への記録に失敗した場合もタスク作成自体を失敗として扱う(fail-closed)。
        // 実運用では「主処理は成功させ記録失敗はログのみ」という fail-open 判断もありうるが、
        // ここでは ports 経由の連携が失敗しうることを明示するために fail-closed を採用する。
        deps.activityRecorder
          .recordTaskCreated({ id: task.id, title: task.title })
          .map(() => task)
          .mapErr(() => "Unexpected" as const),
      )
      .map((task) => ({ item: { id: task.id } }));
  };
}
