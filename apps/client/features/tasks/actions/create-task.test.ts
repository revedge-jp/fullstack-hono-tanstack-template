import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("@tanstack/react-start", () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: (fn: (ctx: { data: { title: string } }) => unknown) => fn,
    }),
  }),
}));

mock.module("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("http://localhost/", { headers: { cookie: "session=test" } }),
}));

let mockOk = true;
let mockErrorBody: unknown = { ok: false, error: "Invalid" };

mock.module("hono/client", () => ({
  hc: () => ({
    api: {
      tasks: {
        $post: mock(() =>
          Promise.resolve({
            ok: mockOk,
            json: async () => mockErrorBody,
          }),
        ),
      },
    },
  }),
}));

const { createTaskServerFn } = await import("./create-task");

describe("tasks.createTaskServerFn", () => {
  beforeEach(() => {
    mockOk = true;
    mockErrorBody = { ok: false, error: "Invalid" };
  });

  test("正常: API が成功を返す場合 { ok: true } を返す", async () => {
    mockOk = true;
    const result = await createTaskServerFn({ data: { title: "Write docs" } });
    expect(result).toEqual({ ok: true });
  });

  test("異常: API がエラーを返す場合 { ok: false, message } を返す", async () => {
    mockOk = false;
    mockErrorBody = { ok: false, error: "Conflict" };
    const result = await createTaskServerFn({ data: { title: "Write docs" } });
    expect(result).toEqual({ ok: false, message: "Conflict" });
  });
});
