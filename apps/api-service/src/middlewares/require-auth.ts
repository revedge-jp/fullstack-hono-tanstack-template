import type { makeGetSession } from "@app/features/auth/application/get-session/usecase";
import type { AuthUser } from "@app/features/auth/domain/models";
import { toHttp } from "@app/shared/http/to-http";
import { createMiddleware } from "hono/factory";

type Env = {
  Variables: {
    user: AuthUser;
  };
};

/**
 * セッションを検証し、認証済みユーザーを context に載せる。
 * 未認証は 401、検証失敗は 500 を返し、後続のハンドラには到達させない。
 * ハンドラからは `c.get("user")` で参照できる（createAuthedApp と組で使うこと）。
 */
export function requireAuth(getSession: ReturnType<typeof makeGetSession>) {
  return createMiddleware<Env>(async (c, next) => {
    const session = await getSession(c.req.raw);
    if (session.isErr()) {
      return toHttp(c, session, { Unauthorized: 401, Unexpected: 500 });
    }
    c.set("user", session.value);
    await next();
  });
}
