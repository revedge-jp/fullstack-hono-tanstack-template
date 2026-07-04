import type { ActivityRepository } from "../domain/activity.repository";
import { makeListActivities, makeRecordActivity } from "./index";

export type ActivityService = ReturnType<typeof createActivityService>;

export function createActivityService(deps: { activityRepository: ActivityRepository }) {
  const { activityRepository } = deps;

  const recordActivity = makeRecordActivity({ activityRepository });
  const listActivities = makeListActivities({ activityRepository });

  return { recordActivity, listActivities };
}
