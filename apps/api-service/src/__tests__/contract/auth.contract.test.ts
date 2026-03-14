import { describe, expect, test } from "bun:test";
import type { AuthUser } from "@app/features/auth/domain/models";
import { createAuthRouter } from "@app/features/auth/presentation/router";
import { err, ok } from "@repo/result";
import { Hono } from "hono";

const mockUser: AuthUser = {
  id: "user-1" as AuthUser["id"],
  email: "test@example.com",
  name: "Test User",
};

function createTestApp(
  getSession: (
    req: Request,
  ) => Promise<
    ReturnType<typeof ok<AuthUser>> | ReturnType<typeof err<"Unauthorized" | "Unexpected">>
  >,
) {
  return new Hono().route("/api", createAuthRouter({ getSession }));
}

describe("GET /api/me — contract", () => {
  test("認証済み: 200 + { ok: true, data: AuthUser }", async () => {
    const app = createTestApp(async () => ok(mockUser));
    const res = await app.request("/api/me");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      data: { id: "user-1", email: "test@example.com", name: "Test User" },
    });
  });

  test("未認証: 401 + { ok: false, error: 'Unauthorized' }", async () => {
    const app = createTestApp(async () => err("Unauthorized" as const));
    const res = await app.request("/api/me");

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "Unauthorized" });
  });

  test("予期しないエラー: 500 + { ok: false, error: 'Unexpected' }", async () => {
    const app = createTestApp(async () => err("Unexpected" as const));
    const res = await app.request("/api/me");

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "Unexpected" });
  });
});
