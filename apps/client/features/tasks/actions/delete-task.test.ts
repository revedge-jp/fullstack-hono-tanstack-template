import { beforeEach, describe, expect, mock, test } from "bun:test";

import { createApiMock } from "@/test-helpers/api-mock";

const api = createApiMock({ body: { ok: false, error: "NotFound" } });
await mock.module("@/shared/lib/browser-api-client", api.browserApiClientModule);

const { deleteTask } = await import("./delete-task");

describe("tasks.deleteTask action", () => {
  beforeEach(() => api.reset());

  test("正常: API が成功を返す場合 { ok: true } を返し、id が渡る", async () => {
    const result = await deleteTask({ id: "task-1" });
    expect(result).toEqual({ ok: true });
    expect(api.state.lastParam).toEqual({ id: "task-1" });
  });

  test("異常: API のエラーコードは生のまま出さず日本語の文言に置き換える", async () => {
    api.state.ok = false;
    api.state.body = { ok: false, error: "NotFound" };
    const result = await deleteTask({ id: "unknown" });
    expect(result).toEqual({
      ok: false,
      message: "タスクが見つかりません。既に削除された可能性があります",
    });
  });

  test("異常: エラーレスポンスの形が想定外の場合は既定メッセージ", async () => {
    api.state.ok = false;
    api.state.body = null;
    const result = await deleteTask({ id: "task-1" });
    expect(result).toEqual({ ok: false, message: "タスクの削除に失敗しました" });
  });

  test("異常: 通信に失敗しても reject せず { ok: false, message } を返す", async () => {
    api.state.callError = new TypeError("Failed to fetch");
    const result = await deleteTask({ id: "task-1" });
    expect(result).toEqual({
      ok: false,
      message: "通信に失敗しました。接続を確認して再度お試しください",
    });
  });
});
