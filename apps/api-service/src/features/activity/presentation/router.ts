import { createAuthedApp } from "@app/factory";
import type { makeGetSession } from "@app/features/auth/application/get-session/usecase";
import { requireAuth } from "@app/middlewares/require-auth";
import { toHttp } from "@app/shared/http/to-http";

import type { ActivityService } from "../application/service";

export function createActivityRouter(deps: {
  activity: ActivityService;
  getSession: ReturnType<typeof makeGetSession>;
}) {
  return createAuthedApp()
    .use(requireAuth(deps.getSession))
    .get("/", async (c) => {
      const result = await deps.activity.listActivities({ ownerId: c.get("user").id });
      return toHttp(c, result, { Unexpected: 500 });
    });
}
