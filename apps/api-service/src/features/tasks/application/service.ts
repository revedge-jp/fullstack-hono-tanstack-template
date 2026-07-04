import type { TasksRepository } from "../domain/tasks.repository";
import {
  makeAdvanceTask,
  makeCreateTask,
  makeDeleteTask,
  makeGetTask,
  makeListTasks,
} from "./index";
import type { ActivityRecorder } from "./ports";

export type TasksService = ReturnType<typeof createTasksService>;

export function createTasksService(deps: {
  tasksRepository: TasksRepository;
  activityRecorder: ActivityRecorder;
}) {
  const { tasksRepository, activityRecorder } = deps;

  const createTask = makeCreateTask({ tasksRepository, activityRecorder });
  const listTasks = makeListTasks({ tasksRepository });
  const getTask = makeGetTask({ tasksRepository });
  const advanceTask = makeAdvanceTask({ tasksRepository });
  const deleteTask = makeDeleteTask({ tasksRepository });

  return { createTask, listTasks, getTask, advanceTask, deleteTask };
}
