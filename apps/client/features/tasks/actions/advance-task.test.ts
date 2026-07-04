import { beforeEach, describe, expect, mock, test } from "bun:test";

let mockOk = true;
let mockBody: unknown = { ok: false, error: "NotFound" };
let lastParam: unknown;

mock.module("hono/client", () => ({
  hc: () => ({
    api: {
      tasks: {
        ":id": {
          $patch: mock((args: { param?: unknown }) => {
            lastParam = args?.param;
            return Promise.resolve({ ok: mockOk, json: async () => mockBody });
          }),
        },
      },
    },
  }),
}));

const { advanceTask } = await import("./advance-task");

describe("tasks.advanceTask action", () => {
  beforeEach(() => {
    mockOk = true;
    mockBody = { ok: false, error: "NotFound" };
    lastParam = undefined;
  });

  test("正常: API が成功を返す場合 { ok: true } を返し、id が渡る", async () => {
    const result = await advanceTask({ id: "task-1" });
    expect(result).toEqual({ ok: true });
    expect(lastParam).toEqual({ id: "task-1" });
  });

  test("異常: API がエラーを返す場合 { ok: false, message } を返す", async () => {
    mockOk = false;
    mockBody = { ok: false, error: "AlreadyDone" };
    const result = await advanceTask({ id: "task-1" });
    expect(result).toEqual({ ok: false, message: "AlreadyDone" });
  });

  test("異常: エラーレスポンスの形が想定外の場合は既定メッセージ", async () => {
    mockOk = false;
    mockBody = "not-json-shape";
    const result = await advanceTask({ id: "task-1" });
    expect(result).toEqual({ ok: false, message: "タスクの更新に失敗しました" });
  });
});
