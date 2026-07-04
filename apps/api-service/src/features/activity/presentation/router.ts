import { createApp } from "@app/factory";
import { toHttp } from "@app/shared/http/to-http";
import type { ActivityService } from "../application/service";

export function createActivityRouter(deps: { activity: ActivityService }) {
  return createApp().get("/", async (c) => {
    const result = await deps.activity.listActivities();
    return toHttp(c, result, { Unexpected: 500 });
  });
}
