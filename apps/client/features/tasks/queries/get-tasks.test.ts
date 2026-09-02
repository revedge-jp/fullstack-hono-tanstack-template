import { beforeEach, describe, expect, mock, test } from "bun:test";

import { createApiMock, reactStartModule, reactStartServerModule } from "@/test-helpers/api-mock";

const TASKS_PAGE = {
  ok: true,
  data: { items: [{ id: "task-1", title: "Write docs", status: "todo" }], nextCursor: null },
};

const api = createApiMock({ body: TASKS_PAGE });
mock.module("@/shared/lib/api-client", api.apiClientModule);
mock.module("@tanstack/react-start", reactStartModule);
mock.module("@tanstack/react-start/server", reactStartServerModule());

const { getTasksServerFn } = await import("./get-tasks");

describe("tasks.getTasksServerFn", () => {
  beforeEach(() => api.reset());

  test("正常: タスク一覧を返す。cursor はクエリで渡り、cookie を転送する", async () => {
    const result = await getTasksServerFn({ data: { cursor: "cursor-abc" } });
    expect(result).toEqual({
      items: [{ id: "task-1", title: "Write docs", status: "todo" }],
      nextCursor: null,
    });
    expect(api.state.lastQuery).toEqual({ cursor: "cursor-abc" });
    expect(api.state.lastHeaders).toEqual({ cookie: "session=test" });
  });

  test("cursor 未指定の場合は空クエリで呼ぶ", async () => {
    await getTasksServerFn({ data: {} });
    expect(api.state.lastQuery).toEqual({});
  });

  test("401 の場合は空ページを返す（リダイレクトは _authenticated ガードが担う）", async () => {
    api.state.ok = false;
    api.state.status = 401;
    const result = await getTasksServerFn({ data: {} });
    expect(result).toEqual({ items: [], nextCursor: null });
  });

  test("異常: API が 500 を返した場合は throw する（0件と区別してエラーバウンダリへ）", async () => {
    api.state.ok = false;
    api.state.status = 500;
    await expect(getTasksServerFn({ data: {} })).rejects.toThrow("タスク一覧の取得に失敗しました");
  });

  test("異常: レスポンス形状が不正な場合は throw する", async () => {
    api.state.body = { unexpected: true };
    await expect(getTasksServerFn({ data: {} })).rejects.toThrow(
      "タスク一覧のレスポンスが不正です",
    );
  });
});
