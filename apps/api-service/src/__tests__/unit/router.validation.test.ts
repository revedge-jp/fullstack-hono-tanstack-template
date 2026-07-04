import { describe, expect, test } from "bun:test";
import type { AuthUser } from "@app/features/auth/domain/models";
import { reconstituteTask } from "@app/features/tasks/domain/models";
import { createTasksRouter } from "@app/features/tasks/presentation/router";
import { Hono } from "hono";
import { okAsync } from "neverthrow";

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

function createTestApp() {
  const tasks = {
    createTask: () => okAsync({ item: { id: mockTask.id } }),
    listTasks: () => okAsync({ items: [mockTask], nextCursor: null }),
    getTask: () => okAsync(mockTask),
    advanceTask: () => okAsync(mockTask),
    deleteTask: () => okAsync(undefined),
  };
  return new Hono().route(
    "/api/tasks",
    createTasksRouter({ tasks, getSession: () => okAsync(mockUser) }),
  );
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
