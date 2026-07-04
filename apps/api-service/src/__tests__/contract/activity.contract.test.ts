import { describe, expect, test } from "bun:test";
import { reconstituteActivity } from "@app/features/activity/domain/models";
import { createActivityRouter } from "@app/features/activity/presentation/router";
import { Hono } from "hono";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";

const mockActivity = reconstituteActivity({
  id: "activity-1",
  kind: "task_created",
  message: "Task created",
  occurredAt: new Date(),
});

function createTestApp(overrides?: {
  listActivities?: () => ResultAsync<{ items: (typeof mockActivity)[] }, "Unexpected">;
}) {
  const activity = {
    recordActivity: () => okAsync({ item: { id: mockActivity.id } }),
    listActivities: overrides?.listActivities ?? (() => okAsync({ items: [mockActivity] })),
  };
  return new Hono().route("/api/activities", createActivityRouter({ activity }));
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

  test("異常: 500 + { ok: false, error: 'Unexpected' }", async () => {
    const app = createTestApp({ listActivities: () => errAsync("Unexpected" as const) });
    const res = await app.request("/api/activities");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "Unexpected" });
  });
});
