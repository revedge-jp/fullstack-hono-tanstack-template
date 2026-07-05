import { beforeEach, describe, expect, mock, test } from "bun:test";

let mockOk = true;
let mockStatus = 200;
let mockBody: unknown;
let lastQuery: unknown;
let lastHeaders: Record<string, string> | undefined;

mock.module("@/shared/lib/api-client", () => ({
  getApiClient: () => ({
    api: {
      tasks: {
        $get: mock(
          (args: { query?: unknown }, opts?: { init?: { headers?: Record<string, string> } }) => {
            lastQuery = args?.query;
            lastHeaders = opts?.init?.headers;
            return Promise.resolve({
              ok: mockOk,
              status: mockStatus,
              json: async () => mockBody,
            });
          },
        ),
      },
    },
  }),
}));

mock.module("@tanstack/react-start", () => ({
  createServerFn: () => ({
    validator: () => ({
      handler: (fn: (ctx: { data: { cursor?: string } }) => unknown) => fn,
    }),
  }),
}));

mock.module("@tanstack/react-start/server", () => ({
  getRequest: () =>
    new Request("http://localhost/", {
      headers: { cookie: "session=test" },
    }),
}));

const { getTasksServerFn } = await import("./get-tasks");

describe("tasks.getTasksServerFn", () => {
  beforeEach(() => {
    mockOk = true;
    mockStatus = 200;
    mockBody = {
      ok: true,
      data: { items: [{ id: "task-1", title: "Write docs", status: "todo" }], nextCursor: null },
    };
    lastQuery = undefined;
    lastHeaders = undefined;
  });

  test("正常: タスク一覧を返す。cursor はクエリで渡り、cookie を転送する", async () => {
    const result = await getTasksServerFn({ data: { cursor: "cursor-abc" } });
    expect(result).toEqual({
      items: [{ id: "task-1", title: "Write docs", status: "todo" }],
      nextCursor: null,
    });
    expect(lastQuery).toEqual({ cursor: "cursor-abc" });
    expect(lastHeaders).toEqual({ cookie: "session=test" });
  });

  test("cursor 未指定の場合は空クエリで呼ぶ", async () => {
    await getTasksServerFn({ data: {} });
    expect(lastQuery).toEqual({});
  });

  test("401 の場合は空ページを返す（リダイレクトは _authenticated ガードが担う）", async () => {
    mockOk = false;
    mockStatus = 401;
    const result = await getTasksServerFn({ data: {} });
    expect(result).toEqual({ items: [], nextCursor: null });
  });

  test("異常: API が 500 を返した場合は throw する（0件と区別してエラーバウンダリへ）", async () => {
    mockOk = false;
    mockStatus = 500;
    await expect(getTasksServerFn({ data: {} })).rejects.toThrow("タスク一覧の取得に失敗しました");
  });

  test("異常: レスポンス形状が不正な場合は throw する", async () => {
    mockBody = { unexpected: true };
    await expect(getTasksServerFn({ data: {} })).rejects.toThrow(
      "タスク一覧のレスポンスが不正です",
    );
  });
});
