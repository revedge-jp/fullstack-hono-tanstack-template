import { describe, expect, test } from "bun:test";

import type { AuthUser } from "@app/features/auth/domain/models";
import { createAuthRouter } from "@app/features/auth/presentation/router";
import { Hono } from "hono";
import { okAsync } from "neverthrow";

const mockUser: AuthUser = {
  id: "user-1" as AuthUser["id"],
  email: "test@example.com",
  name: "Test User",
};

const noop = () => okAsync(mockUser);

function createTestApp() {
  return new Hono().route("/api", createAuthRouter({ getSession: noop }));
}

describe("auth router — validation", () => {
  // GET /api/me はリクエストボディ・クエリパラメータを取らないため 400 ケースなし

  test("存在しないパス: 404", async () => {
    const app = createTestApp();
    const res = await app.request("/api/me/unknown");
    expect(res.status).toBe(404);
  });

  test("POST /api/me は 404 (GET のみ定義)", async () => {
    const app = createTestApp();
    const res = await app.request("/api/me", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
