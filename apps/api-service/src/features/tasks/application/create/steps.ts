import { okAsync, type ResultAsync } from "neverthrow";

import type { TasksRepository } from "../../domain/tasks.repository";
import type { ActivityRecorder } from "../ports";
import type { CreateTaskValidated } from "./validators";

type Logger = { warn: (obj: unknown, msg?: string) => void };

type CreateTaskStepOutput = ResultAsync<{ item: { id: string } }, "Conflict" | "Unexpected">;

export function makeCreateTaskStep(deps: {
  tasksRepository: TasksRepository;
  activityRecorder: ActivityRecorder;
  logger: Logger;
}) {
  return function createTaskStep(input: CreateTaskValidated): CreateTaskStepOutput {
    return deps.tasksRepository
      .create(input)
      .andThen((task) =>
        // activity への記録は fail-open: 失敗しても warn ログのみでタスク作成は成功として返す。
        // この時点でタスクは既に INSERT 済みなので、ここで失敗(500)を返すと
        // 「ユーザーには失敗に見えるのに再試行すると Conflict(409)」という部分書き込みの
        // 不整合が起きる。副次的な記録の失敗で主処理を失敗扱いにしない。
        // （両方を不可分にしたい場合は同一 DB トランザクションで包む設計が必要）
        deps.activityRecorder
          .recordTaskCreated({ id: task.id, title: task.title })
          .orElse((e) => {
            deps.logger.warn({ err: e, taskId: task.id }, "activity の記録に失敗しました");
            return okAsync(undefined);
          })
          .map(() => task),
      )
      .map((task) => ({ item: { id: task.id } }));
  };
}
