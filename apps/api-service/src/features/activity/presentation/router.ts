import { createAuthedApp } from "@app/factory";
import { type GetSession, requireAuth } from "@app/middlewares/require-auth";
import { toHttp } from "@app/shared/http/to-http";

import type { ActivityService } from "../application/service";

export function createActivityRouter(deps: { activity: ActivityService; getSession: GetSession }) {
  return createAuthedApp()
    .use(requireAuth(deps.getSession))
    .get("/", async (c) => {
      const result = await deps.activity.listActivities({ ownerId: c.get("user").id });
      return toHttp(c, result, { Unexpected: 500 });
    });
}
