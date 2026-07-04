import { okAsync, type ResultAsync } from "neverthrow";

import type { ActivityRepository } from "../../domain/activity.repository";
import { makeRecordActivityStep } from "./steps";
import { type RecordActivityInput, validateRecordActivity } from "./validators";

type RecordActivityError = "Invalid" | "Unexpected";

export function makeRecordActivity(deps: { activityRepository: ActivityRepository }) {
  const recordActivityStep = makeRecordActivityStep(deps);
  return function recordActivity(
    input: RecordActivityInput,
  ): ResultAsync<{ item: { id: string } }, RecordActivityError> {
    return okAsync(input).andThen(validateRecordActivity).andThen(recordActivityStep);
  };
}
