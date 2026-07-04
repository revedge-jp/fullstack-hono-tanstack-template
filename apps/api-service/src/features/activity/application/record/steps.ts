import type { ResultAsync } from "neverthrow";
import type { ActivityRepository } from "../../domain/activity.repository";
import type { RecordActivityInput } from "./validators";

type RecordActivityStepOutput = ResultAsync<{ item: { id: string } }, "Unexpected">;

export function makeRecordActivityStep(deps: { activityRepository: ActivityRepository }) {
  return function recordActivityStep(input: RecordActivityInput): RecordActivityStepOutput {
    return deps.activityRepository.record(input).map((activity) => ({ item: { id: activity.id } }));
  };
}
