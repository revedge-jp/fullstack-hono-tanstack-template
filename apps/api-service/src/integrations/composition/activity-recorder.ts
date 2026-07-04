import type { ActivityService } from "@app/features/activity/application/service";
import type { ActivityRecorder } from "@app/features/tasks/application/ports";

/**
 * tasks の ActivityRecorder ポートを、activity feature の service を束ねて実装するアダプタ。
 * tasks → activity の連鎖はこのファイルに閉じ込められ、tasks 本体には一切現れない。
 */
export function createActivityRecorder(deps: { activity: ActivityService }): ActivityRecorder {
  return {
    recordTaskCreated: (task) =>
      deps.activity
        .recordActivity({
          kind: "task_created",
          message: `Task "${task.title}" (${task.id}) created`,
        })
        .map(() => undefined)
        .mapErr(() => "Unexpected" as const),
  };
}
