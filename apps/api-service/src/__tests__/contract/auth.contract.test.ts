import { describe, expect, test } from "bun:test";

import type { AuthUser } from "@app/features/auth/domain/models";
import { createAuthRouter } from "@app/features/auth/presentation/router";
import { Hono } from "hono";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";

const mockUser: AuthUser = {
  id: "user-1" as AuthUser["id"],
  email: "test@example.com",
  name: "Test User",
};

type VerifiedSession = { user: AuthUser; setCookieHeaders: string[] };

function createTestApp(
  getSession: (req: Request) => ResultAsync<VerifiedSession, "Unauthorized" | "Unexpected">,
) {
  return new Hono().route("/api", createAuthRouter({ getSession }));
}

describe("GET /api/me — contract", () => {
  test("認証済み: 200 + { ok: true, data: AuthUser }", async () => {
    const app = createTestApp(() => okAsync({ user: mockUser, setCookieHeaders: [] }));
    const res = await app.request("/api/me");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      data: { id: "user-1", email: "test@example.com", name: "Test User" },
    });
  });

  test("セッション延長の Set-Cookie をそのままレスポンスに付け、本文には載せない", async () => {
    const setCookieHeaders = [
      "better-auth.session_token=abc; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax",
      "better-auth.session_data=xyz; Expires=Fri, 02 Oct 2026 00:00:00 GMT; Path=/; HttpOnly",
    ];
    const app = createTestApp(() => okAsync({ user: mockUser, setCookieHeaders }));
    const res = await app.request("/api/me");

    expect(res.status).toBe(200);
    // Expires の中のカンマで分かれないよう、1 つずつ別のヘッダーになっている
    expect(res.headers.getSetCookie()).toEqual(setCookieHeaders);
    const text = await res.text();
    expect(text).not.toContain("session_token");
    expect(text).not.toContain("setCookieHeaders");
  });

  test("未認証: 401 + { ok: false, error: 'Unauthorized' }", async () => {
    const app = createTestApp(() => errAsync("Unauthorized" as const));
    const res = await app.request("/api/me");

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "Unauthorized" });
  });

  test("予期しないエラー: 500 + { ok: false, error: 'Unexpected' }", async () => {
    const app = createTestApp(() => errAsync("Unexpected" as const));
    const res = await app.request("/api/me");

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "Unexpected" });
  });
});
