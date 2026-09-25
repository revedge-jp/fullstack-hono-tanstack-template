import { describe, expect, test } from "bun:test";

import type { AuthUser } from "@app/features/auth/domain/models";
import { Hono } from "hono";
import { errAsync, okAsync } from "neverthrow";

import { requireAuth } from "./require-auth";

const user = { id: "user-1", email: "a@example.com", name: "A" } as AuthUser;
// Expires の日付にカンマを含む値も、1 つの Set-Cookie として残ることを見る
const setCookieHeaders = [
  "better-auth.session_token=abc; Max-Age=604800; Path=/; HttpOnly",
  "better-auth.session_data=xyz; Expires=Fri, 02 Oct 2026 00:00:00 GMT; Path=/",
];

function createApp() {
  const app = new Hono();
  app.onError((_e, c) => c.json({ ok: false }, 500));
  app.use(
    "*",
    requireAuth(() => okAsync({ user, setCookieHeaders })),
  );
  app.get("/json", (c) => c.json({ ok: true }));
  // ハンドラが Response を直接返しても、セッション延長の Set-Cookie は消えない
  app.get("/raw", () => new Response("raw", { headers: { "set-cookie": "own=1" } }));
  app.get("/throw", () => {
    throw new Error("boom");
  });
  return app;
}

describe("requireAuth — セッション延長の Set-Cookie", () => {
  test.each(["/json", "/raw", "/throw"])("%s のレスポンスに付く", async (path) => {
    const res = await createApp().request(path);

    expect(res.headers.getSetCookie()).toEqual(expect.arrayContaining(setCookieHeaders));
  });

  test("ハンドラ自身の Set-Cookie は残る", async () => {
    const res = await createApp().request("/raw");

    expect(res.headers.getSetCookie()).toContain("own=1");
  });

  test("未認証なら 401 で、後続のハンドラには届かない", async () => {
    const app = new Hono();
    let reached = false;
    app.use(
      "*",
      requireAuth(() => errAsync("Unauthorized" as const)),
    );
    app.get("/", (c) => {
      reached = true;
      return c.json({ ok: true });
    });

    const res = await app.request("/");

    expect(res.status).toBe(401);
    expect(reached).toBe(false);
  });
});
