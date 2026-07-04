import { createApp } from "@app/factory";
import { toHttp } from "@app/shared/http/to-http";
import type { makeGetSession } from "../application/get-session/usecase";

export function createAuthRouter(deps: { getSession: ReturnType<typeof makeGetSession> }) {
  return createApp().get("/me", async (c) => {
    const result = await deps.getSession(c.req.raw);
    return toHttp(c, result, {
      Unauthorized: 401,
      Unexpected: 500,
    });
  });
}
