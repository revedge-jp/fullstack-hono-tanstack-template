import { describe, expect, test } from "bun:test";
import type { AuthUser } from "@app/features/auth/domain/models";
import { reconstituteTask } from "@app/features/tasks/domain/models";
import { createTasksRouter } from "@app/features/tasks/presentation/router";
import { Hono } from "hono";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";

const mockUser: AuthUser = {
  id: "user-1" as AuthUser["id"],
  email: "test@example.com",
  name: "Test User",
};

const mockTask = reconstituteTask({
  id: "task-1",
  ownerId: mockUser.id,
  title: "Write docs",
  status: "todo",
  createdAt: new Date(),
  updatedAt: new Date(),
});

type MockTasks = {
  createTask?: () => ResultAsync<{ item: { id: string } }, "Conflict" | "Invalid" | "Unexpected">;
  listTasks?: (input?: {
    cursor?: string;
    limit?: number;
  }) => ResultAsync<
    { items: (typeof mockTask)[]; nextCursor: string | null },
    "Invalid" | "Unexpected"
  >;
  getTask?: () => ResultAsync<typeof mockTask, "NotFound" | "Unexpected">;
  advanceTask?: () => ResultAsync<typeof mockTask, "AlreadyDone" | "NotFound" | "Unexpected">;
  deleteTask?: () => ResultAsync<void, "NotFound" | "Unexpected">;
  getSession?: () => ResultAsync<AuthUser, "Unauthorized" | "Unexpected">;
};

function createTestApp(overrides: MockTasks = {}) {
  const tasks = {
    createTask: overrides.createTask ?? (() => okAsync({ item: { id: mockTask.id } })),
    listTasks: overrides.listTasks ?? (() => okAsync({ items: [mockTask], nextCursor: null })),
    getTask: overrides.getTask ?? (() => okAsync(mockTask)),
    advanceTask: overrides.advanceTask ?? (() => okAsync(mockTask)),
    deleteTask: overrides.deleteTask ?? (() => okAsync(undefined)),
  };
  return new Hono().route(
    "/api/tasks",
    createTasksRouter({ tasks, getSession: overrides.getSession ?? (() => okAsync(mockUser)) }),
  );
}

describe("POST /api/tasks — contract", () => {
  test("正常: 201 + { ok: true, data: { item: { id } } }", async () => {
    const app = createTestApp();
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Write docs" }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, data: { item: { id: "task-1" } } });
  });

  test("未認証: 401", async () => {
    const app = createTestApp({ getSession: () => errAsync("Unauthorized" as const) });
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Write docs" }),
    });
    expect(res.status).toBe(401);
  });

  test("タイトル重複: 409 + { ok: false, error: 'Conflict' }", async () => {
    const app = createTestApp({ createTask: () => errAsync("Conflict" as const) });
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Write docs" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "Conflict" });
  });
});

describe("GET /api/tasks — contract", () => {
  test("正常: 200 + { ok: true, data: { items, nextCursor } }", async () => {
    const app = createTestApp();
    const res = await app.request("/api/tasks");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.nextCursor).toBeNull();
  });

  test("cursor / limit クエリがユースケースへ渡る", async () => {
    let received: unknown;
    const app = createTestApp({
      listTasks: (input) => {
        received = input;
        return okAsync({ items: [], nextCursor: null });
      },
    });
    const res = await app.request("/api/tasks?cursor=abc&limit=5");
    expect(res.status).toBe(200);
    expect(received).toMatchObject({ cursor: "abc", limit: 5 });
  });

  test("不正な cursor: 400 + { ok: false, error: 'Invalid' }", async () => {
    const app = createTestApp({ listTasks: () => errAsync("Invalid" as const) });
    const res = await app.request("/api/tasks?cursor=broken");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Invalid" });
  });

  test("limit が範囲外(0)の場合: 400（クエリバリデーション）", async () => {
    const app = createTestApp();
    const res = await app.request("/api/tasks?limit=0");
    expect(res.status).toBe(400);
  });
});

// :id ルートは UUID 形式のみ受け付ける（非 UUID は DB に触れず 404）ため、
// テストの URL も UUID 形式で組み立てる
const EXISTING_ID = "00000000-0000-4000-8000-000000000001";
const MISSING_ID = "00000000-0000-4000-8000-00000000dead";

describe("GET /api/tasks/:id — contract", () => {
  test("存在しない場合: 404 + { ok: false, error: 'NotFound' }", async () => {
    const app = createTestApp({ getTask: () => errAsync("NotFound" as const) });
    const res = await app.request(`/api/tasks/${MISSING_ID}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "NotFound" });
  });

  test("id が UUID 形式でない場合: DB に問い合わせず 404", async () => {
    const app = createTestApp({
      getTask: () => {
        throw new Error("getTask should not be called for a non-UUID id");
      },
    });
    const res = await app.request("/api/tasks/not-a-uuid");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "NotFound" });
  });
});

describe("PATCH /api/tasks/:id — contract", () => {
  test("done から進めた場合: 409 + { ok: false, error: 'AlreadyDone' }", async () => {
    const app = createTestApp({ advanceTask: () => errAsync("AlreadyDone" as const) });
    const res = await app.request(`/api/tasks/${EXISTING_ID}`, { method: "PATCH" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "AlreadyDone" });
  });

  test("id が UUID 形式でない場合: 404", async () => {
    const app = createTestApp();
    const res = await app.request("/api/tasks/not-a-uuid", { method: "PATCH" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/tasks/:id — contract", () => {
  test("正常: 204", async () => {
    const app = createTestApp();
    const res = await app.request(`/api/tasks/${EXISTING_ID}`, { method: "DELETE" });
    expect(res.status).toBe(204);
  });

  test("存在しない場合: 404", async () => {
    const app = createTestApp({ deleteTask: () => errAsync("NotFound" as const) });
    const res = await app.request(`/api/tasks/${MISSING_ID}`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  test("id が UUID 形式でない場合: 404", async () => {
    const app = createTestApp();
    const res = await app.request("/api/tasks/not-a-uuid", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
