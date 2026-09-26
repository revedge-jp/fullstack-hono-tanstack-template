import type { makeGetSession } from "@app/features/auth/application/get-session/usecase";
import type { AuthUser } from "@app/features/auth/domain/models";
import { appendSetCookieHeaders } from "@app/shared/http/set-cookie";
import { toHttp } from "@app/shared/http/to-http";
import { createMiddleware } from "hono/factory";

// feature の presentation はこの型でセッション検証を受け取る（auth feature の usecase を直接参照すると
// feature 間の依存になる。dependency-cruiser の server-cross-features-*）
export type GetSession = ReturnType<typeof makeGetSession>;

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
export function requireAuth(getSession: GetSession) {
  return createMiddleware<Env>(async (c, next) => {
    const session = await getSession(c.req.raw);
    if (session.isErr()) {
      return toHttp(c, session, { Unauthorized: 401, Unexpected: 500 });
    }
    c.set("user", session.value.user);
    await next();
    // セッション延長の Set-Cookie は next() の後、出来上がったレスポンスに付ける。前に c.header で
    // 付けると、ハンドラが new Response(...) を直接返したときに消える
    appendSetCookieHeaders(c, session.value.setCookieHeaders);
  });
}
