import { createApp } from "@app/factory";
import type { DevAuth } from "@app/integrations/external/dev-auth";
import { setCookie } from "hono/cookie";

const DEV_USER_ID = "dev-bypass-user";
const DEV_USER_EMAIL = "dev-bypass@localhost";
const DEV_USER_NAME = "Dev Bypass User";

export function createDevAuthRouter(deps: { devAuth: DevAuth | undefined }) {
  return createApp().get("/login", async (c) => {
    // devAuth は本番(nodeEnv === "production")では container.ts が生成しないため undefined になる。
    // ルート自体は AppType の静的な形を保つため常にマウントし、ここで無効化する。
    if (!deps.devAuth) {
      return c.json({ ok: false, error: "Not Found" }, 404);
    }
    const ctx = await deps.devAuth.$context;
    const test = ctx.test;

    // dev-bypass-user が未作成なら作成してから login。既に存在すればそのまま login する
    // (test.login は findUserById が失敗すると例外を投げる)。
    let result: Awaited<ReturnType<typeof test.login>>;
    try {
      result = await test.login({ userId: DEV_USER_ID });
    } catch {
      const user = test.createUser({
        id: DEV_USER_ID,
        email: DEV_USER_EMAIL,
        name: DEV_USER_NAME,
        emailVerified: true,
      });
      await test.saveUser(user);
      result = await test.login({ userId: DEV_USER_ID });
    }

    for (const cookie of result.cookies) {
      setCookie(c, cookie.name, cookie.value, {
        path: cookie.path,
        domain: cookie.domain,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
        expires: cookie.expires ? new Date(cookie.expires * 1000) : undefined,
      });
    }

    return c.redirect("/");
  });
}
