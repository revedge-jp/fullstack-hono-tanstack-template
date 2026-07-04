import { beforeEach, describe, expect, mock, test } from "bun:test";

let mockOk = true;
let mockBody: unknown = { ok: false, error: "Invalid" };
let lastJson: unknown;

mock.module("hono/client", () => ({
  hc: () => ({
    api: {
      tasks: {
        $post: mock((args: { json?: unknown }) => {
          lastJson = args?.json;
          return Promise.resolve({ ok: mockOk, json: async () => mockBody });
        }),
      },
    },
  }),
}));

const { createTask } = await import("./create-task");

describe("tasks.createTask action", () => {
  beforeEach(() => {
    mockOk = true;
    mockBody = { ok: false, error: "Invalid" };
    lastJson = undefined;
  });

  test("正常: API が成功を返す場合 { ok: true } を返し、title が渡る", async () => {
    const result = await createTask({ title: "Write docs" });
    expect(result).toEqual({ ok: true });
    expect(lastJson).toEqual({ title: "Write docs" });
  });

  test("異常: API がエラーを返す場合 { ok: false, message } を返す", async () => {
    mockOk = false;
    mockBody = { ok: false, error: "Conflict" };
    const result = await createTask({ title: "Write docs" });
    expect(result).toEqual({ ok: false, message: "Conflict" });
  });

  test("異常: エラーレスポンスの形が想定外の場合は既定メッセージ", async () => {
    mockOk = false;
    mockBody = { unexpected: true };
    const result = await createTask({ title: "Write docs" });
    expect(result).toEqual({ ok: false, message: "タスクの作成に失敗しました" });
  });
});
