import { beforeEach, describe, expect, mock, test } from "bun:test";

let mockContainer: unknown;

mock.module("@/shared/lib/server-container", () => ({
  getServerContainer: () => mockContainer,
}));

mock.module("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (fn: () => unknown) => fn,
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
  data: { items: [{ id: "task-1", title: "Write docs", status: "todo" }] },
};

mock.module("hono/client", () => ({
  hc: () => ({
    api: {
      tasks: {
        $get: mock(() =>
          Promise.resolve({ ok: mockOk, status: mockStatus, json: async () => mockBody }),
        ),
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
      data: { items: [{ id: "task-1", title: "Write docs", status: "todo" }] },
    };
  });

  describe("CF Workers パス (container あり)", () => {
    test("正常: container 経由でタスク一覧を返す", async () => {
      mockContainer = {
        getSession: async () => ({ isErr: () => false, value: { id: "user-1" } }),
        tasks: {
          listTasks: async () => ({
            isErr: () => false,
            value: { items: [{ id: "task-1", title: "Write docs", status: "todo" }] },
          }),
        },
      };
      const result = await getTasksServerFn();
      expect(result).toEqual({
        items: [{ id: "task-1", title: "Write docs", status: "todo" }],
      });
    });

    test("未認証の場合は空配列を返す（リダイレクトは _authenticated ガードが担う）", async () => {
      mockContainer = {
        getSession: async () => ({ isErr: () => true }),
      };
      const result = await getTasksServerFn();
      expect(result).toEqual({ items: [] });
    });

    test("異常: 一覧取得が失敗した場合は throw する（0件と区別してエラーバウンダリへ）", async () => {
      mockContainer = {
        getSession: async () => ({ isErr: () => false, value: { id: "user-1" } }),
        tasks: {
          listTasks: async () => ({ isErr: () => true }),
        },
      };
      await expect(getTasksServerFn()).rejects.toThrow("タスク一覧の取得に失敗しました");
    });
  });

  describe("ローカル dev フォールバック (container なし)", () => {
    test("正常: API からタスク一覧を返す", async () => {
      const result = await getTasksServerFn();
      expect(result).toEqual({
        items: [{ id: "task-1", title: "Write docs", status: "todo" }],
      });
    });

    test("401 の場合は空配列を返す（リダイレクトは _authenticated ガードが担う）", async () => {
      mockOk = false;
      mockStatus = 401;
      const result = await getTasksServerFn();
      expect(result).toEqual({ items: [] });
    });

    test("異常: API が 500 を返した場合は throw する", async () => {
      mockOk = false;
      mockStatus = 500;
      await expect(getTasksServerFn()).rejects.toThrow("タスク一覧の取得に失敗しました");
    });

    test("異常: レスポンス形状が不正な場合は throw する", async () => {
      mockBody = { unexpected: true };
      await expect(getTasksServerFn()).rejects.toThrow("タスク一覧のレスポンスが不正です");
    });
  });
});
