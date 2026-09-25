import { createApp } from "@app/factory";
import { appendSetCookieHeaders } from "@app/shared/http/set-cookie";
import { toHttp } from "@app/shared/http/to-http";

import type { makeGetSession } from "../application/get-session/usecase";

export function createAuthRouter(deps: { getSession: ReturnType<typeof makeGetSession> }) {
  return createApp().get("/me", async (c) => {
    const result = await deps.getSession(c.req.raw);
    if (result.isOk()) {
      appendSetCookieHeaders(c, result.value.setCookieHeaders);
    }
    // 本文にはユーザーだけを載せる（Set-Cookie の値を JSON に出すと、httpOnly の session_token を
    // JS から読めてしまう）
    return toHttp(
      c,
      result.map((session) => session.user),
      {
        Unauthorized: 401,
        Unexpected: 500,
      },
    );
  });
}
