import { beforeEach, describe, expect, mock, test } from "bun:test";

let mockContainer: unknown;

mock.module("@/shared/lib/server-container", () => ({
  getServerContainer: () => mockContainer,
}));

mock.module("@tanstack/react-start", () => ({
  createServerFn: () => ({
    inputValidator: () => ({
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

let mockOk = true;
let mockStatus = 200;
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
          return Promise.resolve({ ok: mockOk, status: mockStatus, json: async () => mockBody });
        }),
      },
    },
  }),
}));

const { getTasksServerFn } = await import("./get-tasks");

describe("tasks.getTasksServerFn", () => {
  beforeEach(() => {
    mockContainer = undefined;
    mockOk = true;
    mockStatus = 200;
    mockBody = {
      ok: true,
      data: { items: [{ id: "task-1", title: "Write docs", status: "todo" }], nextCursor: null },
    };
    lastQuery = undefined;
  });

  describe("CF Workers パス (container あり)", () => {
    test("正常: container 経由でタスク一覧と nextCursor を返す", async () => {
      let receivedCursor: string | undefined;
      mockContainer = {
        getSession: async () => ({ isErr: () => false, value: { id: "user-1" } }),
        tasks: {
          listTasks: async (input: { cursor?: string }) => {
            receivedCursor = input.cursor;
            return {
              isErr: () => false,
              value: {
                items: [{ id: "task-1", title: "Write docs", status: "todo" }],
                nextCursor: "cursor-abc",
              },
            };
          },
        },
      };
      const result = await getTasksServerFn({ data: { cursor: "cursor-prev" } });
      expect(result).toEqual({
        items: [{ id: "task-1", title: "Write docs", status: "todo" }],
        nextCursor: "cursor-abc",
      });
      expect(receivedCursor).toBe("cursor-prev");
    });

    test("未認証の場合は空ページを返す（リダイレクトは _authenticated ガードが担う）", async () => {
      mockContainer = {
        getSession: async () => ({ isErr: () => true }),
      };
      const result = await getTasksServerFn({ data: {} });
      expect(result).toEqual({ items: [], nextCursor: null });
    });

    test("異常: 一覧取得が失敗した場合は throw する（0件と区別してエラーバウンダリへ）", async () => {
      mockContainer = {
        getSession: async () => ({ isErr: () => false, value: { id: "user-1" } }),
        tasks: {
          listTasks: async () => ({ isErr: () => true }),
        },
      };
      await expect(getTasksServerFn({ data: {} })).rejects.toThrow(
        "タスク一覧の取得に失敗しました",
      );
    });
  });

  describe("ローカル dev フォールバック (container なし)", () => {
    test("正常: API からタスク一覧を返す。cursor はクエリで渡る", async () => {
      const result = await getTasksServerFn({ data: { cursor: "cursor-abc" } });
      expect(result).toEqual({
        items: [{ id: "task-1", title: "Write docs", status: "todo" }],
        nextCursor: null,
      });
      expect(lastQuery).toEqual({ cursor: "cursor-abc" });
    });

    test("401 の場合は空ページを返す（リダイレクトは _authenticated ガードが担う）", async () => {
      mockOk = false;
      mockStatus = 401;
      const result = await getTasksServerFn({ data: {} });
      expect(result).toEqual({ items: [], nextCursor: null });
    });

    test("異常: API が 500 を返した場合は throw する", async () => {
      mockOk = false;
      mockStatus = 500;
      await expect(getTasksServerFn({ data: {} })).rejects.toThrow(
        "タスク一覧の取得に失敗しました",
      );
    });

    test("異常: レスポンス形状が不正な場合は throw する", async () => {
      mockBody = { unexpected: true };
      await expect(getTasksServerFn({ data: {} })).rejects.toThrow(
        "タスク一覧のレスポンスが不正です",
      );
    });
  });
});
