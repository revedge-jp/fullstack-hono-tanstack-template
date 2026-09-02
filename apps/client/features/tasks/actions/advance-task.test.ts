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

  test("異常: API がエラーを返す場合 { ok: false, message } を返す", async () => {
    api.state.ok = false;
    api.state.body = { ok: false, error: "AlreadyDone" };
    const result = await advanceTask({ id: "task-1" });
    expect(result).toEqual({ ok: false, message: "AlreadyDone" });
  });

  test("異常: エラーレスポンスの形が想定外の場合は既定メッセージ", async () => {
    api.state.ok = false;
    api.state.body = "not-json-shape";
    const result = await advanceTask({ id: "task-1" });
    expect(result).toEqual({ ok: false, message: "タスクの更新に失敗しました" });
  });
});
