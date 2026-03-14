import { createApp } from "@app/factory";
import type { makeGetSession } from "../application/get-session/usecase";

export function createAuthRouter(deps: { getSession: ReturnType<typeof makeGetSession> }) {
  return createApp().get("/me", async (c) => {
    const result = await deps.getSession(c.req.raw);
    if (result.type === "err") {
      const status = result.value === "Unauthorized" ? 401 : 500;
      return c.json({ ok: false, error: result.value }, status);
    }
    return c.json({ ok: true, data: result.value });
  });
}
