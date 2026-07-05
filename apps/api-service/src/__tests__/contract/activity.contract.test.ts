import { describe, expect, test } from "bun:test";

import { reconstituteActivity } from "@app/features/activity/domain/models";
import { createActivityRouter } from "@app/features/activity/presentation/router";
import type { AuthUser } from "@app/features/auth/domain/models";
import { Hono } from "hono";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";

const mockUser: AuthUser = {
  id: "user-1" as AuthUser["id"],
  email: "test@example.com",
  name: "Test User",
};

const mockActivity = reconstituteActivity({
  id: "activity-1",
  ownerId: mockUser.id,
  kind: "task_created",
  message: "Task created",
  occurredAt: new Date(),
});

function createTestApp(overrides?: {
  listActivities?: (input: {
    ownerId: string;
  }) => ResultAsync<{ items: (typeof mockActivity)[] }, "Unexpected">;
  getSession?: () => ResultAsync<AuthUser, "Unauthorized" | "Unexpected">;
}) {
  const activity = {
    recordActivity: () => okAsync({ item: { id: mockActivity.id } }),
    listActivities: overrides?.listActivities ?? (() => okAsync({ items: [mockActivity] })),
  };
  return new Hono().route(
    "/api/activities",
    createActivityRouter({
      activity,
      getSession: overrides?.getSession ?? (() => okAsync(mockUser)),
    }),
  );
}

describe("GET /api/activities — contract", () => {
  test("正常: 200 + { ok: true, data: { items } }", async () => {
    const app = createTestApp();
    const res = await app.request("/api/activities");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.items).toHaveLength(1);
  });

  test("認証済みユーザーの ownerId で一覧を取得する", async () => {
    let receivedOwnerId: string | undefined;
    const app = createTestApp({
      listActivities: (input) => {
        receivedOwnerId = input.ownerId;
        return okAsync({ items: [] });
      },
    });
    const res = await app.request("/api/activities");
    expect(res.status).toBe(200);
    expect(receivedOwnerId).toBe(mockUser.id);
  });

  test("未認証: 401 + { ok: false, error: 'Unauthorized' }", async () => {
    const app = createTestApp({ getSession: () => errAsync("Unauthorized" as const) });
    const res = await app.request("/api/activities");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "Unauthorized" });
  });

  test("セッション検証失敗: 500 + { ok: false, error: 'Unexpected' }", async () => {
    const app = createTestApp({ getSession: () => errAsync("Unexpected" as const) });
    const res = await app.request("/api/activities");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "Unexpected" });
  });

  test("異常: 500 + { ok: false, error: 'Unexpected' }", async () => {
    const app = createTestApp({ listActivities: () => errAsync("Unexpected" as const) });
    const res = await app.request("/api/activities");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "Unexpected" });
  });
});
