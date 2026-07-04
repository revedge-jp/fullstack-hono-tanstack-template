import { err, ok, type Result } from "neverthrow";

export type TaskId = string & { readonly _brand: "TaskId" };
export type TaskTitle = string & { readonly _brand: "TaskTitle" };
export type TaskStatus = "todo" | "in_progress" | "done";

export type Task = {
  readonly id: TaskId;
  readonly ownerId: string;
  readonly title: TaskTitle;
  readonly status: TaskStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export function makeTaskTitle(value: string): Result<TaskTitle, "InvalidTitle"> {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 200) {
    return err("InvalidTitle" as const);
  }
  return ok(trimmed as TaskTitle);
}

export function reconstituteTask(raw: {
  id: string;
  ownerId: string;
  title: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): Task {
  return {
    id: raw.id as TaskId,
    ownerId: raw.ownerId,
    title: raw.title as TaskTitle,
    status: raw.status as TaskStatus,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

const NEXT_STATUS: Record<TaskStatus, TaskStatus | null> = {
  todo: "in_progress",
  in_progress: "done",
  done: null,
};

/**
 * タスクを次のステータスへ進める（todo → in_progress → done）。
 * done から先には進めない（ドメイン不変条件）。
 */
export function advanceTaskStatus(task: Task): Result<Task, "AlreadyDone"> {
  const next = NEXT_STATUS[task.status];
  if (!next) {
    return err("AlreadyDone" as const);
  }
  return ok({ ...task, status: next });
}
