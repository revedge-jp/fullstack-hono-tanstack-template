import { okAsync, type ResultAsync } from "neverthrow";
import type { TasksRepository } from "../../domain/tasks.repository";
import type { ActivityRecorder } from "../ports";
import { makeCreateTaskStep } from "./steps";
import { type CreateTaskInput, validateCreateTask } from "./validators";

type CreateTaskError = "Conflict" | "Invalid" | "Unexpected";

export function makeCreateTask(deps: {
  tasksRepository: TasksRepository;
  activityRecorder: ActivityRecorder;
}) {
  const createTaskStep = makeCreateTaskStep(deps);
  return function createTask(
    input: CreateTaskInput,
  ): ResultAsync<{ item: { id: string } }, CreateTaskError> {
    return okAsync(input).andThen(validateCreateTask).andThen(createTaskStep);
  };
}
