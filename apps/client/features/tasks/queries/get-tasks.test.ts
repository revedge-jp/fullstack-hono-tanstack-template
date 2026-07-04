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
let mockBody: unknown = {
  ok: true,
  data: { items: [{ id: "task-1", title: "Write docs", status: "todo" }] },
};

mock.module("hono/client", () => ({
  hc: () => ({
    api: {
      tasks: {
        $get: mock(() => Promise.resolve({ ok: mockOk, json: async () => mockBody })),
      },
    },
  }),
}));

const { getTasksServerFn } = await import("./get-tasks");

describe("tasks.getTasksServerFn", () => {
  beforeEach(() => {
    mockContainer = undefined;
    mockOk = true;
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

    test("異常: セッション未認証の場合は空配列を返す", async () => {
      mockContainer = {
        getSession: async () => ({ isErr: () => true }),
      };
      const result = await getTasksServerFn();
      expect(result).toEqual({ items: [] });
    });
  });

  describe("ローカル dev フォールバック (container なし)", () => {
    test("正常: API からタスク一覧を返す", async () => {
      const result = await getTasksServerFn();
      expect(result).toEqual({
        items: [{ id: "task-1", title: "Write docs", status: "todo" }],
      });
    });

    test("異常: API が失敗した場合は空配列を返す", async () => {
      mockOk = false;
      const result = await getTasksServerFn();
      expect(result).toEqual({ items: [] });
    });
  });
});
