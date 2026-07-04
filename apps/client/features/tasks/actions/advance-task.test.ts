import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("@tanstack/react-start", () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: (fn: (ctx: { data: { id: string } }) => unknown) => fn,
    }),
  }),
}));

mock.module("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("http://localhost/", { headers: { cookie: "session=test" } }),
}));

let mockOk = true;
let mockErrorBody: unknown = { ok: false, error: "NotFound" };

mock.module("hono/client", () => ({
  hc: () => ({
    api: {
      tasks: {
        ":id": {
          $patch: mock(() =>
            Promise.resolve({
              ok: mockOk,
              json: async () => mockErrorBody,
            }),
          ),
        },
      },
    },
  }),
}));

const { advanceTaskServerFn } = await import("./advance-task");

describe("tasks.advanceTaskServerFn", () => {
  beforeEach(() => {
    mockOk = true;
    mockErrorBody = { ok: false, error: "NotFound" };
  });

  test("正常: API が成功を返す場合 { ok: true } を返す", async () => {
    mockOk = true;
    const result = await advanceTaskServerFn({ data: { id: "task-1" } });
    expect(result).toEqual({ ok: true });
  });

  test("異常: API がエラーを返す場合 { ok: false, message } を返す", async () => {
    mockOk = false;
    mockErrorBody = { ok: false, error: "AlreadyDone" };
    const result = await advanceTaskServerFn({ data: { id: "task-1" } });
    expect(result).toEqual({ ok: false, message: "AlreadyDone" });
  });
});
