import { describe, expect, test } from "bun:test";

import { makeGetSession } from "@app/features/auth/application/get-session/usecase";
import { makeVerifySession } from "@app/features/auth/infrastructure/session";
import type { Auth } from "@app/integrations/external/auth";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { testUtils } from "better-auth/plugins";

import { createFakeApp } from "../../test-helpers/create-fake-app";
import { createLoggerSpy } from "../../test-helpers/create-logger-spy";

// createFakeApp は既定で getSession を差し替えるので、Better Auth の Set-Cookie がレスポンスまで
// 届くかはこのファイルでしか確かめられない。本物の Better Auth（メモリ上の DB）で、セッション延長の
// Set-Cookie が /api/me と requireAuth 経由のルートの両方で返ることを見る。
const ORIGIN = "http://localhost:3000";
const DAY_MS = 24 * 60 * 60 * 1000;

type StoredSession = { expiresAt: Date };

async function setUpSignedInUser() {
  const tables: Record<string, unknown[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const auth = betterAuth({
    secret: "c3VwZXItc2VjcmV0LXRlc3Qta2V5LWZvci1iZXR0ZXItYXV0aA",
    baseURL: ORIGIN,
    database: memoryAdapter(tables),
    // 本番（integrations/external/auth.ts）と同じ cookieCache。有効期限と延長の間隔は Better Auth の既定
    // （7 日・1 日）
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    plugins: [testUtils()],
  });
  const context = await auth.$context;
  const user = await context.test.saveUser(context.test.createUser({ email: "a@example.com" }));
  const { headers } = await context.test.login({ userId: user.id });
  const cookie = headers.get("cookie") ?? "";
  const [session] = tables.session as StoredSession[];
  if (!session) {
    throw new Error("login がセッションを作りませんでした");
  }
  const verifySession = makeVerifySession(auth as unknown as Auth, createLoggerSpy().logger);
  return { cookie, session, getSession: makeGetSession({ verifySession }) };
}

function sessionTokenCookies(res: Response) {
  return res.headers.getSetCookie().filter((c) => c.startsWith("better-auth.session_token="));
}

describe("セッション延長の Set-Cookie", () => {
  // 延長は「作成から updateAge（1 日）を過ぎたセッション」で起きる。残り 5 日 = 作成から 2 日
  test("延長の対象になったセッションでは、/api/me が新しい有効期限の session_token を返す", async () => {
    const { cookie, session, getSession } = await setUpSignedInUser();
    session.expiresAt = new Date(Date.now() + 5 * DAY_MS);

    const res = await createFakeApp({ getSession }).request("/api/me", { headers: { cookie } });

    expect(res.status).toBe(200);
    const [refreshed] = sessionTokenCookies(res);
    expect(refreshed).toContain("Max-Age=604800");
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * DAY_MS);
  });

  test("requireAuth を通るルート（/api/tasks）でも session_token を返す", async () => {
    const { cookie, session, getSession } = await setUpSignedInUser();
    session.expiresAt = new Date(Date.now() + 5 * DAY_MS);

    const res = await createFakeApp({ getSession }).request("/api/tasks", { headers: { cookie } });

    expect(res.status).toBe(200);
    expect(sessionTokenCookies(res)[0]).toContain("Max-Age=604800");
  });

  test("延長の対象でなくても、cookieCache（session_data）は書き直す", async () => {
    const { cookie, getSession } = await setUpSignedInUser();

    const res = await createFakeApp({ getSession }).request("/api/tasks", { headers: { cookie } });

    expect(res.status).toBe(200);
    expect(sessionTokenCookies(res)).toEqual([]);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("better-auth.session_data="))).toBe(
      true,
    );
  });
});
