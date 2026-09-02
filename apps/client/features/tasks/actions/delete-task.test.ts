import { beforeEach, describe, expect, mock, test } from "bun:test";

import { createApiMock } from "@/test-helpers/api-mock";

const api = createApiMock({ body: { ok: false, error: "NotFound" } });
mock.module("hono/client", api.honoClientModule);

const { deleteTask } = await import("./delete-task");

describe("tasks.deleteTask action", () => {
  beforeEach(() => api.reset());

  test("正常: API が成功を返す場合 { ok: true } を返し、id が渡る", async () => {
    const result = await deleteTask({ id: "task-1" });
    expect(result).toEqual({ ok: true });
    expect(api.state.lastParam).toEqual({ id: "task-1" });
  });

  test("異常: API がエラーを返す場合 { ok: false, message } を返す", async () => {
    api.state.ok = false;
    api.state.body = { ok: false, error: "NotFound" };
    const result = await deleteTask({ id: "unknown" });
    expect(result).toEqual({ ok: false, message: "NotFound" });
  });

  test("異常: エラーレスポンスの形が想定外の場合は既定メッセージ", async () => {
    api.state.ok = false;
    api.state.body = null;
    const result = await deleteTask({ id: "task-1" });
    expect(result).toEqual({ ok: false, message: "タスクの削除に失敗しました" });
  });
});
