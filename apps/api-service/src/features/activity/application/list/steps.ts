import type { ResultAsync } from "neverthrow";

import type { ActivityRepository } from "../../domain/activity.repository";
import type { Activity } from "../../domain/models";

type FetchActivitiesStepOutput = ResultAsync<{ items: Activity[] }, "Unexpected">;

export function makeFetchActivitiesStep(deps: { activityRepository: ActivityRepository }) {
  return function fetchActivitiesStep(): FetchActivitiesStepOutput {
    return deps.activityRepository.list();
  };
}
