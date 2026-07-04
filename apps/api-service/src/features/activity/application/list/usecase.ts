import { okAsync, type ResultAsync } from "neverthrow";
import type { ActivityRepository } from "../../domain/activity.repository";
import type { Activity } from "../../domain/models";
import { makeFetchActivitiesStep } from "./steps";

type ListActivitiesError = "Unexpected";

export function makeListActivities(deps: { activityRepository: ActivityRepository }) {
  const fetchActivitiesStep = makeFetchActivitiesStep(deps);
  return function listActivities(): ResultAsync<{ items: Activity[] }, ListActivitiesError> {
    return okAsync(undefined).andThen(fetchActivitiesStep);
  };
}
