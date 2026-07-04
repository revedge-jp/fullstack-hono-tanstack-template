import { beforeEach, describe, expect, mock, test } from "bun:test";

let mockOk = true;
let mockBody: unknown = {
  ok: true,
  data: { items: [{ id: "task-1", title: "Write docs", status: "todo" }], nextCursor: null },
};
let lastQuery: unknown;

mock.module("hono/client", () => ({
  hc: () => ({
    api: {
      tasks: {
        $get: mock((args: { query?: unknown }) => {
          lastQuery = args?.query;
          return Promise.resolve({ ok: mockOk, json: async () => mockBody });
        }),
      },
    },
  }),
}));

const { tasksQueryOptions } = await import("./tasks-query");

describe("tasks.tasksQueryOptions", () => {
  beforeEach(() => {
    mockOk = true;
    mockBody = {
      ok: true,
      data: { items: [{ id: "task-1", title: "Write docs", status: "todo" }], nextCursor: null },
    };
    lastQuery = undefined;
  });

  test("queryKey は cursor を含む（ページごとに別キャッシュ）", () => {
    expect([...tasksQueryOptions().queryKey]).toEqual(["tasks", null]);
    expect([...tasksQueryOptions("abc").queryKey]).toEqual(["tasks", "abc"]);
  });

  test("正常: タスク一覧ページを返し、cursor がクエリで渡る", async () => {
    const options = tasksQueryOptions("cursor-abc");
    const result = await options.queryFn?.({} as never);
    expect(result).toEqual({
      items: [{ id: "task-1", title: "Write docs", status: "todo" }],
      nextCursor: null,
    });
    expect(lastQuery).toEqual({ cursor: "cursor-abc" });
  });

  test("異常: API が失敗した場合は throw する", async () => {
    mockOk = false;
    const options = tasksQueryOptions();
    await expect(options.queryFn?.({} as never)).rejects.toThrow("タスク一覧の取得に失敗しました");
  });

  test("異常: レスポンス形状が不正な場合は throw する", async () => {
    mockBody = { unexpected: true };
    const options = tasksQueryOptions();
    await expect(options.queryFn?.({} as never)).rejects.toThrow(
      "タスク一覧のレスポンスが不正です",
    );
  });
});
