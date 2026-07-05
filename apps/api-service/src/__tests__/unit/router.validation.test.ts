import { describe, expect, test } from "bun:test";

import type { AuthUser } from "@app/features/auth/domain/models";
import { createFakeApp } from "api-service/test-helpers";

const mockUser: AuthUser = {
  id: "user-1" as AuthUser["id"],
  email: "test@example.com",
  name: "Test User",
};

// createFakeApp は zero-config で認証済み。ここでは HTTP レベルの入力バリデーション
// （zValidator の 400）だけを検証するので、既定の in-memory tasks service で十分。
function createTestApp() {
  return createFakeApp({ user: mockUser });
}

describe("tasks router — validation", () => {
  test("POST /api/tasks: title が空文字の場合 400", async () => {
    const app = createTestApp();
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/tasks: title が201文字以上の場合 400", async () => {
    const app = createTestApp();
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "a".repeat(201) }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/tasks: title が欠落している場合 400", async () => {
    const app = createTestApp();
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
