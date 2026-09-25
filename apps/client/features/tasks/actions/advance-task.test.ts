import { beforeEach, describe, expect, mock, test } from "bun:test";

import { createApiMock } from "@/test-helpers/api-mock";

const api = createApiMock({ body: { ok: false, error: "NotFound" } });
await mock.module("@/shared/lib/browser-api-client", api.browserApiClientModule);

const { advanceTask } = await import("./advance-task");

describe("tasks.advanceTask action", () => {
  beforeEach(() => api.reset());

  test("正常: API が成功を返す場合 { ok: true } を返し、id が渡る", async () => {
    const result = await advanceTask({ id: "task-1" });
    expect(result).toEqual({ ok: true });
    expect(api.state.lastParam).toEqual({ id: "task-1" });
  });

  test("異常: API のエラーコードは生のまま出さず日本語の文言に置き換える", async () => {
    api.state.ok = false;
    api.state.body = { ok: false, error: "AlreadyDone" };
    const result = await advanceTask({ id: "task-1" });
    expect(result).toEqual({ ok: false, message: "このタスクは既に完了しています" });
  });

  test("異常: 並行更新の Conflict は再読み込みを促す文言にする", async () => {
    api.state.ok = false;
    api.state.body = { ok: false, error: "Conflict" };
    const result = await advanceTask({ id: "task-1" });
    expect(result).toEqual({
      ok: false,
      message: "他の操作でタスクの状態が変わりました。再読み込みしてからやり直してください",
    });
  });

  test("異常: エラーレスポンスの形が想定外の場合は既定メッセージ", async () => {
    api.state.ok = false;
    api.state.body = "not-json-shape";
    const result = await advanceTask({ id: "task-1" });
    expect(result).toEqual({ ok: false, message: "タスクの更新に失敗しました" });
  });

  test("異常: 通信に失敗しても reject せず { ok: false, message } を返す", async () => {
    api.state.callError = new TypeError("Failed to fetch");
    const result = await advanceTask({ id: "task-1" });
    expect(result).toEqual({
      ok: false,
      message: "通信に失敗しました。接続を確認して再度お試しください",
    });
  });
});
