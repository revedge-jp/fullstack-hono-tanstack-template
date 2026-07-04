import { beforeEach, describe, expect, mock, test } from "bun:test";

let mockOk = true;
let mockBody: unknown = { ok: false, error: "NotFound" };
let lastParam: unknown;

mock.module("hono/client", () => ({
  hc: () => ({
    api: {
      tasks: {
        ":id": {
          $delete: mock((args: { param?: unknown }) => {
            lastParam = args?.param;
            return Promise.resolve({ ok: mockOk, json: async () => mockBody });
          }),
        },
      },
    },
  }),
}));

const { deleteTask } = await import("./delete-task");

describe("tasks.deleteTask action", () => {
  beforeEach(() => {
    mockOk = true;
    mockBody = { ok: false, error: "NotFound" };
    lastParam = undefined;
  });

  test("正常: API が成功を返す場合 { ok: true } を返し、id が渡る", async () => {
    const result = await deleteTask({ id: "task-1" });
    expect(result).toEqual({ ok: true });
    expect(lastParam).toEqual({ id: "task-1" });
  });

  test("異常: API がエラーを返す場合 { ok: false, message } を返す", async () => {
    mockOk = false;
    mockBody = { ok: false, error: "NotFound" };
    const result = await deleteTask({ id: "unknown" });
    expect(result).toEqual({ ok: false, message: "NotFound" });
  });

  test("異常: エラーレスポンスの形が想定外の場合は既定メッセージ", async () => {
    mockOk = false;
    mockBody = null;
    const result = await deleteTask({ id: "task-1" });
    expect(result).toEqual({ ok: false, message: "タスクの削除に失敗しました" });
  });
});
